import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

export const MAX_CONTENT_ARCHIVE_SIZE = 20 * 1024 * 1024;
const MAX_UNPACKED_SIZE = 40 * 1024 * 1024;
const MAX_FILE_SIZE = 16 * 1024 * 1024;
const MAX_FILE_COUNT = 250;

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf"
};

export type PackageFile = { path: string; bytes: Uint8Array; contentType: string };
export type PreparedPackage = { name: string; version: string; entryPath: string; files: PackageFile[]; totalBytes: number };

export function contentTypeForModulePath(filePath: string) {
  return mimeTypes[path.posix.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function safePackagePath(value: string) {
  const replaced = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const normalized = path.posix.normalize(replaced);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("Архив содержит небезопасный путь к файлу.");
  }
  return normalized;
}

function stripCommonRoot(files: PackageFile[]) {
  const roots = new Set(files.map((file) => file.path.split("/")[0]));
  if (roots.size !== 1 || files.some((file) => !file.path.includes("/"))) return files;
  const root = [...roots][0];
  return files.map((file) => ({ ...file, path: file.path.slice(root.length + 1) }));
}

function parseManifest(files: PackageFile[]) {
  const file = files.find((item) => item.path.toLowerCase() === "content-module.json");
  if (!file) return {} as { name?: string; version?: string; entry?: string };
  try {
    const value = JSON.parse(strFromU8(file.bytes)) as Record<string, unknown>;
    return {
      name: typeof value.name === "string" ? value.name.trim().slice(0, 120) : undefined,
      version: typeof value.version === "string" ? value.version.trim().slice(0, 40) : undefined,
      entry: typeof value.entry === "string" ? safePackagePath(value.entry) : undefined
    };
  } catch {
    throw new Error("Файл content-module.json содержит некорректный JSON.");
  }
}

export function prepareContentModuleArchive(archive: Uint8Array): PreparedPackage {
  if (!archive.byteLength || archive.byteLength > MAX_CONTENT_ARCHIVE_SIZE) {
    throw new Error("Размер ZIP-архива должен быть не больше 20 МБ.");
  }

  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(archive);
  } catch {
    throw new Error("Не удалось распаковать ZIP. Проверьте, что архив не повреждён и не защищён паролем.");
  }

  const seen = new Set<string>();
  let files = Object.entries(unpacked)
    .filter(([name]) => !name.endsWith("/") && !name.includes("__MACOSX") && !name.endsWith(".DS_Store"))
    .map(([name, bytes]) => {
      const safePath = safePackagePath(name);
      if (seen.has(safePath)) throw new Error(`В архиве повторяется файл ${safePath}.`);
      seen.add(safePath);
      if (bytes.byteLength > MAX_FILE_SIZE) throw new Error(`Файл ${safePath} превышает лимит 16 МБ.`);
      return { path: safePath, bytes, contentType: contentTypeForModulePath(safePath) };
    });

  files = stripCommonRoot(files);
  if (files.length > MAX_FILE_COUNT) throw new Error(`В архиве больше ${MAX_FILE_COUNT} файлов.`);

  const manifest = parseManifest(files);
  const indexes = files
    .filter((file) => file.path.toLowerCase().endsWith("index.html"))
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length);
  let entryPath = manifest.entry ?? indexes[0]?.path;
  if (!entryPath || !files.some((file) => file.path === entryPath)) {
    const hasSources = files.some((file) => /(?:^|\/)(?:package\.json|[^/]+\.(?:tsx?|jsx))$/i.test(file.path));
    throw new Error(hasSources
      ? "В архиве находятся исходники. Сначала создайте статическую сборку, затем загрузите папку dist, build или out с файлом index.html."
      : "В архиве не найден index.html готовой веб-сборки.");
  }

  const entryDirectory = path.posix.dirname(entryPath);
  if (entryDirectory !== ".") {
    const prefix = `${entryDirectory}/`;
    files = files
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
    entryPath = path.posix.basename(entryPath);
  }

  files = files.filter((file) => file.path !== "content-module.json" && !file.path.endsWith(".map"));
  const unsupported = files.find((file) => !mimeTypes[path.posix.extname(file.path).toLowerCase()]);
  if (unsupported) throw new Error(`Формат файла ${unsupported.path} не поддерживается установщиком.`);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (!totalBytes || totalBytes > MAX_UNPACKED_SIZE) throw new Error("Распакованный модуль превышает лимит 40 МБ.");

  return {
    name: manifest.name || "Контент-завод",
    version: manifest.version || "1.0.0",
    entryPath,
    files,
    totalBytes
  };
}
