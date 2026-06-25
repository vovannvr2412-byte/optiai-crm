import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CrmUser } from "@/lib/crm/types";

type Credential = {
  userId: string;
  email: string;
  salt: string;
  hash: string;
};

const globalForCredentials = globalThis as unknown as { optiaiCredentials?: Map<string, Credential> };
const dataDir = process.env.CRM_DATA_DIR || path.join(process.cwd(), "data");
const credentialsFile = path.join(dataDir, "credentials.json");
const tempCredentialsFile = path.join(dataDir, "credentials.tmp.json");

const demoPasswords: Record<string, string> = {
  "owner@optiai.ru": "Owner2026!",
  "rop@optiai.ru": "Rop2026!"
};

function localCredentialFilesEnabled() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function credentials() {
  if (!globalForCredentials.optiaiCredentials) {
    globalForCredentials.optiaiCredentials = readPersistedCredentials();
  }
  return globalForCredentials.optiaiCredentials;
}

export function getCredentialsSnapshot() {
  return [...credentials().values()];
}

export function hydrateCredentialsSnapshot(list: Credential[]) {
  globalForCredentials.optiaiCredentials = new Map(list.map((credential) => [normalizeEmail(credential.email), credential]));
}

function readPersistedCredentials() {
  if (!localCredentialFilesEnabled()) return new Map<string, Credential>();
  if (!existsSync(credentialsFile)) return new Map<string, Credential>();
  try {
    const parsed = JSON.parse(readFileSync(credentialsFile, "utf8")) as Credential[] | { value?: Credential[] };
    const list = Array.isArray(parsed) ? parsed : parsed.value ?? [];
    return new Map(list.map((credential) => [normalizeEmail(credential.email), credential]));
  } catch {
    return new Map<string, Credential>();
  }
}

function persistCredentials() {
  if (!localCredentialFilesEnabled()) return;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(tempCredentialsFile, JSON.stringify([...credentials().values()], null, 2), "utf8");
  renameSync(tempCredentialsFile, credentialsFile);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

export function ensureCredentials(users: CrmUser[]) {
  const store = credentials();
  let changed = false;
  users.forEach((user) => {
    const email = normalizeEmail(user.email);
    if (!store.has(email)) {
      setCredential(user.id, email, demoPasswords[email] ?? "OptiAI2026!");
      changed = true;
    }
  });
  if (changed) persistCredentials();
}

export function registerCredential(userId: string, email: string, password: string) {
  setCredential(userId, email, password);
  persistCredentials();
}

function setCredential(userId: string, email: string, password: string) {
  const normalized = normalizeEmail(email);
  const salt = randomBytes(16).toString("hex");
  credentials().set(normalized, {
    userId,
    email: normalized,
    salt,
    hash: hashPassword(password, salt)
  });
}

export function disableCredential(email: string) {
  credentials().delete(normalizeEmail(email));
  persistCredentials();
}

export function verifyCredential(email: string, password: string) {
  const credential = credentials().get(normalizeEmail(email));
  if (!credential) return null;

  const actual = Buffer.from(hashPassword(password, credential.salt), "hex");
  const expected = Buffer.from(credential.hash, "hex");
  if (actual.length !== expected.length) return null;
  return timingSafeEqual(actual, expected) ? credential.userId : null;
}

export const demoLoginHints = Object.entries(demoPasswords).map(([email, password]) => ({ email, password }));
