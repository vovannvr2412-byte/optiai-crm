import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { CrmUser } from "@/lib/crm/types";
import { MAX_CONTENT_ARCHIVE_SIZE, prepareContentModuleArchive, type PackageFile } from "@/lib/content-module/package";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const CONTENT_MODULE_BUCKET = "content-modules";

type ModuleRow = {
  id: string;
  name: string;
  version: string;
  entry_path: string;
  storage_prefix: string;
  access_token: string;
  object_paths: string[];
  file_count: number;
  total_bytes: number;
  installed_by: string | null;
  installed_at: string;
  updated_at: string;
};

export type ContentModuleInstallation = {
  id: string;
  name: string;
  version: string;
  entryPath: string;
  storagePrefix: string;
  accessToken: string;
  objectPaths: string[];
  fileCount: number;
  totalBytes: number;
  installedBy?: string;
  installedAt: string;
  updatedAt: string;
  runtimeUrl: string;
};

function mapInstallation(row: ModuleRow): ContentModuleInstallation {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    entryPath: row.entry_path,
    storagePrefix: row.storage_prefix,
    accessToken: row.access_token,
    objectPaths: row.object_paths ?? [],
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    installedBy: row.installed_by ?? undefined,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    runtimeUrl: `/content-runtime/${encodeURIComponent(row.access_token)}/${row.entry_path.split("/").map(encodeURIComponent).join("/")}`
  };
}

function databaseError(error: { code?: string; message: string }) {
  if (error.code === "42P01" || error.code === "PGRST205") {
    return new Error("Установщик контента не подготовлен в Supabase. Выполните миграцию 0013_content_module_installer.sql.");
  }
  return new Error(`Не удалось прочитать модуль контента: ${error.message}`);
}

export async function getContentModuleInstallation() {
  const { data, error } = await createServiceSupabaseClient()
    .from("content_module_installations")
    .select("id,name,version,entry_path,storage_prefix,access_token,object_paths,file_count,total_bytes,installed_by,installed_at,updated_at")
    .eq("slot", "default")
    .maybeSingle();
  if (error) throw databaseError(error);
  return data ? mapInstallation(data as ModuleRow) : null;
}

async function removeObjects(storagePrefix: string, objectPaths: string[]) {
  if (!objectPaths.length) return;
  const targets = objectPaths.map((item) => `${storagePrefix}/${item}`);
  for (let index = 0; index < targets.length; index += 100) {
    const { error } = await createServiceSupabaseClient().storage.from(CONTENT_MODULE_BUCKET).remove(targets.slice(index, index + 100));
    if (error) console.error("Content module cleanup failed", { message: error.message });
  }
}

async function uploadPackage(storagePrefix: string, files: PackageFile[]) {
  const storage = createServiceSupabaseClient().storage.from(CONTENT_MODULE_BUCKET);
  const uploaded: string[] = [];
  try {
    for (let index = 0; index < files.length; index += 6) {
      const batch = files.slice(index, index + 6);
      await Promise.all(batch.map(async (file) => {
        const objectPath = `${storagePrefix}/${file.path}`;
        const { error } = await storage.upload(objectPath, file.bytes, {
          contentType: file.contentType,
          cacheControl: file.contentType.startsWith("text/html") ? "0" : "31536000",
          upsert: false
        });
        if (error) throw new Error(`Не удалось загрузить ${file.path}: ${error.message}`);
        uploaded.push(file.path);
      }));
    }
  } catch (error) {
    await removeObjects(storagePrefix, uploaded);
    throw error;
  }
}

export async function createContentModuleUpload(name: string, size: number) {
  if (!name.toLowerCase().endsWith(".zip")) throw new Error("Выберите ZIP-архив готовой веб-сборки.");
  if (!Number.isFinite(size) || size <= 0 || size > MAX_CONTENT_ARCHIVE_SIZE) throw new Error("Размер ZIP-архива должен быть не больше 20 МБ.");
  const objectPath = `staging/${randomUUID()}.zip`;
  const { data, error } = await createServiceSupabaseClient().storage.from(CONTENT_MODULE_BUCKET).createSignedUploadUrl(objectPath);
  if (error) throw new Error(`Хранилище контент-модулей не готово: ${error.message}. Выполните миграцию 0013_content_module_installer.sql.`);
  return {
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
  };
}

export async function installStagedContentModule(stagedPath: string, actor: CrmUser) {
  if (!/^staging\/[0-9a-f-]{36}\.zip$/i.test(stagedPath)) throw new Error("Некорректный адрес загруженного архива.");
  const supabase = createServiceSupabaseClient();
  const storage = supabase.storage.from(CONTENT_MODULE_BUCKET);
  const { data: archive, error: downloadError } = await storage.download(stagedPath);
  if (downloadError || !archive) throw new Error(`Не удалось прочитать загруженный архив: ${downloadError?.message ?? "файл не найден"}`);

  try {
    const prepared = prepareContentModuleArchive(new Uint8Array(await archive.arrayBuffer()));
    const previous = await getContentModuleInstallation();
    const storagePrefix = `installed/${randomUUID()}`;
    const accessToken = randomBytes(24).toString("base64url");
    await uploadPackage(storagePrefix, prepared.files);

    const now = new Date().toISOString();
    const payload = {
      slot: "default",
      name: prepared.name,
      version: prepared.version,
      entry_path: prepared.entryPath,
      storage_prefix: storagePrefix,
      access_token: accessToken,
      object_paths: prepared.files.map((file) => file.path),
      file_count: prepared.files.length,
      total_bytes: prepared.totalBytes,
      installed_by: actor.id,
      installed_at: now,
      updated_at: now
    };
    const { data, error } = await supabase
      .from("content_module_installations")
      .upsert(payload, { onConflict: "slot" })
      .select("id,name,version,entry_path,storage_prefix,access_token,object_paths,file_count,total_bytes,installed_by,installed_at,updated_at")
      .single();
    if (error || !data) {
      await removeObjects(storagePrefix, prepared.files.map((file) => file.path));
      throw databaseError(error ?? { message: "Supabase не вернул установленный модуль." });
    }
    if (previous) await removeObjects(previous.storagePrefix, previous.objectPaths);
    return mapInstallation(data as ModuleRow);
  } finally {
    await storage.remove([stagedPath]);
  }
}

export async function deleteContentModule() {
  const current = await getContentModuleInstallation();
  if (!current) return;
  const { error } = await createServiceSupabaseClient().from("content_module_installations").delete().eq("id", current.id);
  if (error) throw databaseError(error);
  await removeObjects(current.storagePrefix, current.objectPaths);
}
