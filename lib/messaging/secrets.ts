import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { MessengerChannel } from "./types";

type SecretMap = Record<string, string>;
type StoredSecrets = Partial<Record<MessengerChannel, SecretMap>>;
type EncryptedEnvelope = { version: 1; iv: string; tag: string; data: string };

export const messengerSecretFields: Record<MessengerChannel, readonly string[]> = {
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
  whatsapp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_GRAPH_VERSION"],
  max: ["MAX_BOT_TOKEN", "MAX_WEBHOOK_SECRET"],
  instagram: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_ACCOUNT_ID", "INSTAGRAM_VERIFY_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_GRAPH_VERSION"],
  avito: ["AVITO_CLIENT_ID", "AVITO_CLIENT_SECRET", "AVITO_USER_ID", "AVITO_WEBHOOK_SECRET"]
};

const dataDir = process.env.CRM_DATA_DIR || path.join(process.cwd(), "data");
const secretsFile = path.join(dataDir, "messaging-secrets.json");
const tempSecretsFile = path.join(dataDir, "messaging-secrets.tmp.json");
const supabaseKey = "messaging_secrets";
const channelSupabaseKey = (channel: MessengerChannel) => `messaging_secrets_v2_${channel}`;

function supabasePersistenceEnabled() {
  return process.env.CRM_FORCE_LOCAL !== "true" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function key() {
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("Для шифрования настроек мессенджеров задайте AUTH_SECRET.");
  }
  const source = process.env.AUTH_SECRET || "optiai-local-demo-secret-change-me";
  return createHash("sha256").update(`optiai-messaging-secrets:${source}`).digest();
}

function encrypt(value: StoredSecrets): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function decrypt(envelope: EncryptedEnvelope): StoredSecrets {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8")) as StoredSecrets;
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EncryptedEnvelope>;
  return item.version === 1 && typeof item.iv === "string" && typeof item.tag === "string" && typeof item.data === "string";
}

async function readStoredSecrets(): Promise<StoredSecrets> {
  let envelope: unknown = null;
  if (supabasePersistenceEnabled()) {
    const { data, error } = await createServiceSupabaseClient().from("crm_app_state").select("value").eq("key", supabaseKey).maybeSingle();
    if (error) throw error;
    envelope = data?.value ?? null;
  } else if (existsSync(secretsFile)) {
    envelope = JSON.parse(readFileSync(secretsFile, "utf8")) as unknown;
  }
  if (!isEnvelope(envelope)) return {};
  try {
    return decrypt(envelope);
  } catch {
    throw new Error("Не удалось расшифровать настройки мессенджеров. Проверьте, что AUTH_SECRET не менялся.");
  }
}

async function writeStoredSecrets(value: StoredSecrets) {
  const envelope = encrypt(value);
  if (supabasePersistenceEnabled()) {
    const { error } = await createServiceSupabaseClient().from("crm_app_state").upsert({ key: supabaseKey, value: envelope, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(tempSecretsFile, JSON.stringify(envelope, null, 2), "utf8");
  renameSync(tempSecretsFile, secretsFile);
}

async function readChannelSecrets(channel: MessengerChannel): Promise<SecretMap> {
  if (!supabasePersistenceEnabled()) return (await readStoredSecrets())[channel] ?? {};
  const { data, error } = await createServiceSupabaseClient()
    .from("crm_app_state")
    .select("value")
    .eq("key", channelSupabaseKey(channel))
    .maybeSingle();
  if (error) throw error;
  if (data?.value) {
    if (!isEnvelope(data.value)) return {};
    try {
      return decrypt(data.value)[channel] ?? {};
    } catch {
      throw new Error(`Не удалось расшифровать настройки ${channel}. Проверьте AUTH_SECRET или введите все ключи канала заново.`);
    }
  }
  return (await readStoredSecrets())[channel] ?? {};
}

async function writeChannelSecrets(channel: MessengerChannel, values: SecretMap) {
  if (!supabasePersistenceEnabled()) {
    const all = await readStoredSecrets();
    all[channel] = values;
    await writeStoredSecrets(all);
    return;
  }
  const { error } = await createServiceSupabaseClient().from("crm_app_state").upsert({
    key: channelSupabaseKey(channel),
    value: encrypt({ [channel]: values }),
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });
  if (error) throw error;
}

export async function getMessengerSecrets(channel: MessengerChannel) {
  const stored = await readChannelSecrets(channel);
  return Object.fromEntries(messengerSecretFields[channel].map((field) => [field, stored[field] || process.env[field]?.trim() || ""])) as SecretMap;
}

export async function getMessengerSecretPresence(channel: MessengerChannel) {
  const resolved = await getMessengerSecrets(channel);
  return Object.fromEntries(messengerSecretFields[channel].map((field) => [field, Boolean(resolved[field])])) as Record<string, boolean>;
}

export async function saveMessengerSecrets(channel: MessengerChannel, updates: Record<string, string>) {
  const current = await readChannelSecrets(channel);
  for (const field of messengerSecretFields[channel]) {
    const next = updates[field]?.trim();
    if (next) current[field] = next;
  }
  await writeChannelSecrets(channel, current);
  return getMessengerSecretPresence(channel);
}

export async function replaceMessengerSecrets(channel: MessengerChannel, values: Record<string, string>, options: { discardUnreadable?: boolean } = {}) {
  const replacement = Object.fromEntries(
    messengerSecretFields[channel]
      .map((field) => [field, values[field]?.trim() || ""] as const)
      .filter(([, value]) => Boolean(value))
  );
  if (supabasePersistenceEnabled()) {
    await writeChannelSecrets(channel, replacement);
    return getMessengerSecretPresence(channel);
  }
  let all: StoredSecrets;
  try {
    all = await readStoredSecrets();
  } catch (error) {
    if (!options.discardUnreadable) throw error;
    all = {};
  }
  all[channel] = replacement;
  await writeStoredSecrets(all);
  return getMessengerSecretPresence(channel);
}

export async function deleteMessengerSecrets(channel: MessengerChannel) {
  if (supabasePersistenceEnabled()) {
    await writeChannelSecrets(channel, {});
    return;
  }
  const all = await readStoredSecrets();
  delete all[channel];
  await writeStoredSecrets(all);
}
