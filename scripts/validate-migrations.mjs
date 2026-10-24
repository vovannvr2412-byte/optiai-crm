import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const db = new PGlite({ extensions: { pgcrypto } });

async function sql(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create role anon;
  create role authenticated;
  create role service_role;
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
`);

const initial = await sql("supabase/migrations/0001_initial_schema.sql");
const messaging = await sql("supabase/migrations/0002_messaging_center.sql");
const media = await sql("supabase/migrations/0003_media_storage.sql");
const normalized = await sql("supabase/migrations/0004_normalized_crm_and_auth.sql");
const security = await sql("supabase/migrations/0005_single_company_security.sql");
const seed = await sql("supabase/seed.sql");

await db.exec(initial);
await db.exec(initial);
await db.exec(seed);
await db.exec(messaging);
await db.exec(messaging);
await db.exec(media);
await db.exec(media);
await db.exec(normalized);
await db.exec(normalized);
await db.exec(security);
await db.exec(security);

const userId = "20000000-0000-0000-0000-000000000001";
const tariffId = "10000000-0000-0000-0000-000000000001";
const leadId = "40000000-0000-0000-0000-000000000001";
const state = {
  users: [{
    id: userId, fullName: "Test Owner", email: "owner@example.com", role: "Руководитель",
    position: "CEO", status: "active", calls: 0, meetings: 0, revenue: 0, conversion: 0,
    createdAt: "2026-01-01T00:00:00.000Z"
  }],
  tariffs: [{ id: tariffId, name: "SEO + GEO Start", price: 14900 }],
  leads: [{
    id: leadId, companyName: "Test Company", site: "https://example.com", industry: "IT",
    companySize: "10", region: "Москва", contactName: "Test Contact", contactRole: "CEO",
    phone: "+79990000000", email: "contact@example.com", telegram: "", whatsapp: "", max: "",
    hasSeo: null, hasContext: null, hasMarketer: null, hasAgency: null, brandedQueries: null,
    llmVisibility: null, geoPotential: "Новый", stage: 0, status: "sales", sourceChannel: "manual",
    sourceDetail: "", ownerId: userId, score: 20, temperature: "cold", pain: "", currentPromotionChannels: "",
    budget: "", nextStep: "Позвонить", createdAt: "2026-01-01T00:00:00.000Z", tariffId
  }],
  subscriptions: [],
  payments: [],
  tasks: [{
    id: "50000000-0000-0000-0000-000000000001", leadId, ownerId: userId, title: "Позвонить",
    dueAt: "2026-01-02", priority: "medium", status: "open"
  }],
  activities: [{
    id: "60000000-0000-0000-0000-000000000001", leadId, type: "system", title: "Лид создан",
    detail: "Тест", createdAt: "2026-01-01T00:00:00.000Z"
  }],
  callRecords: [],
  warmupSequences: [{
    id: "30000000-0000-0000-0000-000000000001", name: "Test Warmup", description: "Test", active: true,
    steps: [{
      id: "70000000-0000-0000-0000-000000000001", day: 1, title: "Шаг", message: "Сообщение",
      contentType: "Custom"
    }]
  }],
  integrations: [{ id: "telegram", name: "Telegram", description: "Bot", status: "needs_setup", config: {} }]
};

await db.query("select public.save_crm_state_normalized($1::jsonb)", [JSON.stringify(state)]);
const result = await db.query("select public.get_crm_state_normalized() as state");
const restored = result.rows[0].state;

assert.equal(restored.users.length, 1);
assert.equal(restored.leads.length, 1);
assert.equal(restored.tasks.length, 1);
assert.equal(restored.activities.length, 1);
assert.equal(restored.leads[0].companyName, "Test Company");
assert.equal(restored.leads[0].ownerId, userId);
assert.equal(restored.warmupSequences[0].steps.length, 1);

const auditTable = await db.query("select count(*)::integer as count from information_schema.tables where table_schema = 'public' and table_name = 'security_audit_log'");
assert.equal(auditTable.rows[0].count, 1);
const securityPolicies = await db.query("select policyname from pg_policies where schemaname = 'public'");
const policyNames = new Set(securityPolicies.rows.map((row) => row.policyname));
assert(policyNames.has("role based lead read"));
assert(policyNames.has("users read own profile"));
assert(policyNames.has("management reads security audit"));

console.log("Migrations OK: schema is repeatable, RLS policies exist, and normalized CRM state round-trips correctly.");
await db.close();
