import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type { CrmUser } from "@/lib/crm/types";

type Credential = {
  userId: string;
  email: string;
  salt: string;
  hash: string;
};

const globalForCredentials = globalThis as unknown as { optiaiCredentials?: Map<string, Credential> };

const demoPasswords: Record<string, string> = {
  "owner@optiai.ru": "Owner2026!",
  "rop@optiai.ru": "Rop2026!",
  "anna@optiai.ru": "Anna2026!",
  "ilya@optiai.ru": "Ilya2026!",
  "sofia@optiai.ru": "Sofia2026!"
};

function credentials() {
  if (!globalForCredentials.optiaiCredentials) {
    globalForCredentials.optiaiCredentials = new Map();
  }
  return globalForCredentials.optiaiCredentials;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

export function ensureCredentials(users: CrmUser[]) {
  const store = credentials();
  users.forEach((user) => {
    const email = normalizeEmail(user.email);
    if (!store.has(email)) {
      registerCredential(user.id, email, demoPasswords[email] ?? "OptiAI2026!");
    }
  });
}

export function registerCredential(userId: string, email: string, password: string) {
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
