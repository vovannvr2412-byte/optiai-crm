import { randomUUID } from "node:crypto";
import { moscowDateKey } from "@/lib/time/moscow";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const MEDIA_BUCKET = "crm-media";
export const MAX_MEDIA_SIZE = 25 * 1024 * 1024;

const localDirectory = path.join(process.env.CRM_DATA_DIR || path.join(process.cwd(), "data"), "uploads");
const extensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm"
};

export function validateMediaMeta(input: { name: string; type: string; size: number }) {
  if (!extensions[input.type]) throw new Error("Поддерживаются JPG, PNG, WEBP, GIF, MP4, MOV и WEBM.");
  const providerLimit = input.type.startsWith("image/") ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > providerLimit) {
    throw new Error(input.type.startsWith("image/") ? "Размер изображения должен быть не больше 5 МБ." : "Размер видео должен быть не больше 16 МБ.");
  }
  return { extension: extensions[input.type], mediaType: input.type.startsWith("image/") ? "image" as const : "video" as const };
}

export function mediaPersistenceUsesSupabase() {
  return process.env.CRM_FORCE_LOCAL !== "true" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function createMediaUpload(name: string, type: string, size: number) {
  const validated = validateMediaMeta({ name, type, size });
  const objectPath = `warmup/${moscowDateKey()}/${randomUUID()}${validated.extension}`;
  if (!mediaPersistenceUsesSupabase()) {
    return { mode: "local" as const, fileName: path.basename(objectPath), mediaType: validated.mediaType };
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(objectPath);
  if (error) throw new Error(`Хранилище медиа не готово: ${error.message}. Выполните миграцию 0003_media_storage.sql.`);
  const publicUrl = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath).data.publicUrl;
  return {
    mode: "signed" as const,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl,
    mediaType: validated.mediaType,
    publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
  };
}

export function saveLocalMedia(fileName: string, bytes: Uint8Array) {
  const safeName = path.basename(fileName);
  if (safeName !== fileName) throw new Error("Некорректное имя файла.");
  mkdirSync(localDirectory, { recursive: true });
  writeFileSync(path.join(localDirectory, safeName), bytes, { flag: "wx" });
}

export async function persistMessengerMedia(input: {
  bytes: ArrayBuffer;
  mimeType: string;
  baseUrl: string;
}) {
  const mimeType = input.mimeType.split(";", 1)[0].trim().toLowerCase();
  const extension = extensions[mimeType];
  if (!extension || (!mimeType.startsWith("image/") && !mimeType.startsWith("video/"))) {
    throw new Error("Формат медиафайла не поддерживается хранилищем CRM.");
  }
  if (!input.bytes.byteLength || input.bytes.byteLength > MAX_MEDIA_SIZE) {
    throw new Error("Медиафайл превышает лимит 25 МБ.");
  }

  const objectPath = `messengers/${moscowDateKey()}/${randomUUID()}${extension}`;
  if (!mediaPersistenceUsesSupabase()) {
    const fileName = path.basename(objectPath);
    saveLocalMedia(fileName, new Uint8Array(input.bytes));
    return new URL(`/api/media/${encodeURIComponent(fileName)}`, input.baseUrl).toString();
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(objectPath, input.bytes, {
    contentType: mimeType,
    cacheControl: "31536000",
    upsert: false
  });
  if (error) throw new Error(`Не удалось сохранить медиафайл в CRM: ${error.message}`);
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

export function isTrustedMediaUrl(value: string, requestUrl: string) {
  try {
    const mediaUrl = new URL(value);
    const requestOrigin = new URL(requestUrl).origin;
    if (mediaUrl.origin === requestOrigin && mediaUrl.pathname.startsWith("/api/media/")) return true;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    return Boolean(supabaseUrl && value.startsWith(`${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/`));
  } catch {
    return false;
  }
}

export function readLocalMedia(fileName: string) {
  const safeName = path.basename(fileName);
  if (safeName !== fileName) return null;
  const target = path.join(localDirectory, safeName);
  if (!existsSync(target)) return null;
  return readFileSync(target);
}

export function contentTypeForLocalMedia(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return Object.entries(extensions).find(([, value]) => value === extension)?.[0] ?? "application/octet-stream";
}
