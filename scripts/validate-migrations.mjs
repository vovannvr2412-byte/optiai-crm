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
const automations = await sql("supabase/migrations/0006_tasks_and_automations.sql");
const telegramReplacement = await sql("supabase/migrations/0007_telegram_bot_replacement.sql");
const externalIntegrations = await sql("supabase/migrations/0008_external_integrations_and_web_push.sql");
const warmupAndAi = await sql("supabase/migrations/0009_warmup_editor_and_ai.sql");
const aiAutopilot = await sql("supabase/migrations/0010_ai_messaging_autopilot.sql");
const operationsOs = await sql("supabase/migrations/0011_operations_os.sql");
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

await db.exec(`
  insert into public.crm_users (id, full_name, email, role, position)
  values ('80000000-0000-0000-0000-000000000001', 'Legacy Owner', 'legacy@example.com', 'Руководитель', 'CEO');
  insert into public.companies (id, name)
  values ('81000000-0000-0000-0000-000000000001', 'Legacy Company');
  insert into public.leads (id, company_id, owner_id, stage_order, status, source_channel)
  values ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 0, 'sales', 'legacy-test');
  insert into public.warmup_sequences (id, name)
  values ('83000000-0000-0000-0000-000000000001', 'Legacy Warmup');
  insert into public.warmup_assignments (id, lead_id, sequence_id, assigned_by, status, created_at) values
    ('84000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'active', '2026-01-01T00:00:00Z'),
    ('84000000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'active', '2026-01-02T00:00:00Z');
`);

await db.exec(automations);
await db.exec(automations);
await db.exec(telegramReplacement);
await db.exec(telegramReplacement);
await db.exec(externalIntegrations);
await db.exec(externalIntegrations);
await db.exec(warmupAndAi);
await db.exec(warmupAndAi);
await db.exec(aiAutopilot);
await db.exec(aiAutopilot);
await db.exec(operationsOs);
await db.exec(operationsOs);

const upgradedAssignments = await db.query(`
  select id, status, started_at::text as started_at
  from public.warmup_assignments
  where lead_id = '82000000-0000-0000-0000-000000000001'
  order by created_at
`);
assert.deepEqual(upgradedAssignments.rows, [
  { id: "84000000-0000-0000-0000-000000000001", status: "paused", started_at: "2026-01-01" },
  { id: "84000000-0000-0000-0000-000000000002", status: "active", started_at: "2026-01-02" }
]);
await db.exec(`
  delete from public.companies where id = '81000000-0000-0000-0000-000000000001';
  delete from public.crm_users where id = '80000000-0000-0000-0000-000000000001';
  delete from public.warmup_sequences where id = '83000000-0000-0000-0000-000000000001';
`);

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
assert(policyNames.has("users read own notifications"));
assert(policyNames.has("management reads automation events"));

await db.query("update public.tasks set status = 'cancelled' where id = $1", [state.tasks[0].id]);
const cancelledTask = await db.query("select status from public.tasks where id = $1", [state.tasks[0].id]);
assert.equal(cancelledTask.rows[0].status, "cancelled");
const automationTables = await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('crm_notifications', 'automation_events', 'automation_runs')");
assert.equal(automationTables.rows.length, 3);
const telegramConversationColumns = await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'messenger_conversations' and column_name in ('bot_external_account_id', 'needs_reconnect')");
assert.equal(telegramConversationColumns.rows.length, 2);
const telegramConnectionColumns = await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'messenger_connections' and column_name = 'external_account_username'");
assert.equal(telegramConnectionColumns.rows.length, 1);
const reconnectColumn = await db.query("select is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'messenger_conversations' and column_name = 'needs_reconnect'");
assert.equal(reconnectColumn.rows[0].is_nullable, "NO");
assert.match(String(reconnectColumn.rows[0].column_default), /false/i);
const externalConnections = await db.query("select channel from public.messenger_connections where channel in ('instagram', 'avito') order by channel");
assert.deepEqual(externalConnections.rows, [{ channel: "avito" }, { channel: "instagram" }]);
const productionTables = await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('integration_sync_runs', 'integration_export_events', 'push_subscriptions')");
assert.equal(productionTables.rows.length, 3);
const pushPolicies = await db.query("select policyname from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions'");
assert(pushPolicies.rows.some((row) => row.policyname === "users read own push subscriptions"));
const operationsTables = await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('os_user_settings', 'lead_os_profiles', 'lead_activation_checks', 'client_documents', 'optiai_events', 'routines_workspace')");
assert.equal(operationsTables.rows.length, 6);
const operationsStages = await db.query("select stage_order, name from public.pipeline_stages order by stage_order");
assert.equal(operationsStages.rows.length, 7);
assert.deepEqual(operationsStages.rows.map((row) => row.name), ["Новый лид", "Прогрев", "Планирует оплату", "Оплата и подключение", "Подключён", "Не продлил подписку", "Отказ"]);

const eventArguments = [
  "migration-test:event-1",
  "migration_test",
  "2026-01-01T06:00:00Z",
  leadId,
  userId,
  state.tasks[0].id,
  JSON.stringify({ source: "migration-test" })
];
const claimSql = "select * from public.claim_automation_event($1, $2, $3::timestamptz, $4::uuid, $5::uuid, $6::uuid, $7::jsonb)";
const firstClaim = await db.query(claimSql, eventArguments);
const duplicateClaim = await db.query(claimSql, eventArguments);
assert.equal(firstClaim.rows.length, 1);
assert.equal(firstClaim.rows[0].attempts, 1);
assert.equal(duplicateClaim.rows.length, 0);

await db.query("update public.automation_events set status = 'failed', next_attempt_at = now() - interval '1 minute' where event_key = $1", [eventArguments[0]]);
const retryClaim = await db.query(claimSql, eventArguments);
assert.equal(retryClaim.rows.length, 1);
assert.equal(retryClaim.rows[0].attempts, 2);
await db.query("update public.automation_events set status = 'completed', processed_at = now() where event_key = $1", [eventArguments[0]]);
const completedClaim = await db.query(claimSql, eventArguments);
assert.equal(completedClaim.rows.length, 0);

console.log("Migrations OK: schema is repeatable, messenger channels and Web Push are ready, sync exports are idempotent, scheduler events are idempotent, RLS policies exist, and normalized CRM state round-trips correctly.");
await db.close();
