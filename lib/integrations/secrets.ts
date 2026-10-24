import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

type SecretMap = Record<string, string>;
type StoredSecrets = Record<string, SecretMap>;
type EncryptedEnvelope = { version: 1; iv: string; tag: string; data: string };

const dataDir = process.env.CRM_DATA_DIR || path.join(process.cwd(), "data");
const secretsFile = path.join(dataDir, "integration-secrets.json");
const tempSecretsFile = path.join(dataDir, "integration-secrets.tmp.json");
const supabaseKey = "integration_secrets_v1";

function supabasePersistenceEnabled() {
  return process.env.CRM_FORCE_LOCAL !== "true" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function encryptionKey() {
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("Для шифрования интеграций задайте AUTH_SECRET.");
  }
  const source = process.env.AUTH_SECRET || "optiai-local-demo-secret-change-me";
  return createHash("sha256").update(`optiai-integration-secrets:${source}`).digest();
}

function encrypt(value: StoredSecrets): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  };
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EncryptedEnvelope>;
  return item.version === 1 && typeof item.iv === "string" && typeof item.tag === "string" && typeof item.data === "string";
}

function decrypt(envelope: EncryptedEnvelope): StoredSecrets {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]).toString("utf8")) as StoredSecrets;
}

async function readSecrets(): Promise<StoredSecrets> {
  let envelope: unknown = null;
  if (supabasePersistenceEnabled()) {
    const { data, error } = await createServiceSupabaseClient()
      .from("crm_app_state")
      .select("value")
      .eq("key", supabaseKey)
      .maybeSingle();
    if (error) throw error;
    envelope = data?.value ?? null;
  } else if (existsSync(secretsFile)) {
    envelope = JSON.parse(readFileSync(secretsFile, "utf8")) as unknown;
  }
  if (!isEnvelope(envelope)) return {};
  try {
    return decrypt(envelope);
  } catch {
    throw new Error("Не удалось расшифровать интеграции. Проверьте, что AUTH_SECRET не менялся.");
  }
}

async function writeSecrets(value: StoredSecrets) {
  const envelope = encrypt(value);
  if (supabasePersistenceEnabled()) {
    const { error } = await createServiceSupabaseClient().from("crm_app_state").upsert({
      key: supabaseKey,
      value: envelope,
      updated_at: new Date().toISOString()
    }, { onConflict: "key" });
    if (error) throw error;
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(tempSecretsFile, JSON.stringify(envelope, null, 2), "utf8");
  renameSync(tempSecretsFile, secretsFile);
}

export async function saveIntegrationSecrets(integrationId: string, updates: Record<string, string>) {
  const all = await readSecrets();
  const current = all[integrationId] ?? {};
  for (const [field, rawValue] of Object.entries(updates)) {
    const value = rawValue.trim();
    if (value) current[field] = value;
  }
  all[integrationId] = current;
  await writeSecrets(all);
}

export async function migrateLegacyIntegrationSecrets(integrations: { id: string; config?: Record<string, string> }[]) {
  const legacy = integrations.filter((integration) => integration.config && Object.keys(integration.config).length > 0);
  if (legacy.length === 0) return false;
  for (const integration of legacy) {
    await saveIntegrationSecrets(integration.id, integration.config ?? {});
    delete integration.config;
  }
  return true;
}
