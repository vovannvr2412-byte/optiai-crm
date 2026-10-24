import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error("Supabase environment variables are required.");
}

const service = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `LiveTest-${randomUUID()}-7a`;
const fixtures = [
  { key: "owner", role: "Руководитель", position: "Руководитель" },
  { key: "rop", role: "РОП", position: "Руководитель отдела продаж" },
  { key: "manager", role: "Менеджер", position: "Менеджер по продажам" },
  { key: "account", role: "Аккаунт-менеджер", position: "Аккаунт-менеджер" }
].map((fixture) => ({
  ...fixture,
  email: `security-${fixture.key}-${runId}@example.com`,
  authId: null,
  crmId: null,
  client: null
}));

let companyId = null;
let auditId = null;

function expectNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function createAuthenticatedFixture(fixture) {
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email: fixture.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Security ${fixture.key}` }
  });
  expectNoError(authError, `create Auth user ${fixture.key}`);
  fixture.authId = authData.user.id;

  const { data: crmUser, error: crmError } = await service
    .from("crm_users")
    .insert({
      auth_user_id: fixture.authId,
      full_name: `Security ${fixture.key}`,
      email: fixture.email,
      role: fixture.role,
      position: fixture.position,
      status: "active",
      invited_at: new Date().toISOString()
    })
    .select("id")
    .single();
  expectNoError(crmError, `create CRM user ${fixture.key}`);
  fixture.crmId = crmUser.id;

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email: fixture.email, password });
  expectNoError(signInError, `sign in ${fixture.key}`);
  fixture.client = client;
}

async function readScope(fixture) {
  const [roleResult, usersResult, leadsResult, auditResult] = await Promise.all([
    fixture.client.rpc("current_crm_role"),
    fixture.client.from("crm_users").select("id").like("email", "security-%"),
    fixture.client.from("leads").select("id").like("source_channel", "security-%"),
    fixture.client.from("security_audit_log").select("id").eq("entity_id", runId)
  ]);
  expectNoError(roleResult.error, `${fixture.key} role`);
  expectNoError(usersResult.error, `${fixture.key} users`);
  expectNoError(leadsResult.error, `${fixture.key} leads`);
  expectNoError(auditResult.error, `${fixture.key} audit`);
  return {
    role: roleResult.data,
    users: usersResult.data.length,
    leads: leadsResult.data.length,
    audit: auditResult.data.length
  };
}

async function cleanup() {
  const cleanupErrors = [];
  const remove = async (promise, label) => {
    try {
      const { error } = await promise;
      if (error) cleanupErrors.push(`${label}: ${error.message}`);
    } catch (error) {
      cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (auditId) await remove(service.from("security_audit_log").delete().eq("id", auditId), "audit");
  if (companyId) await remove(service.from("companies").delete().eq("id", companyId), "company");
  for (const fixture of fixtures) {
    if (fixture.crmId) await remove(service.from("crm_users").delete().eq("id", fixture.crmId), `CRM ${fixture.key}`);
  }
  for (const fixture of fixtures) {
    if (fixture.authId) {
      try {
        const { error } = await service.auth.admin.deleteUser(fixture.authId);
        if (error) cleanupErrors.push(`Auth ${fixture.key}: ${error.message}`);
      } catch (error) {
        cleanupErrors.push(`Auth ${fixture.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (cleanupErrors.length) throw new Error(`Fixture cleanup failed:\n${cleanupErrors.join("\n")}`);
}

try {
  const schemaCheck = await service.from("crm_users").select("invited_at,last_login_at").limit(1);
  expectNoError(schemaCheck.error, "security migration columns");
  const auditCheck = await service.from("security_audit_log").select("id", { count: "exact", head: true });
  expectNoError(auditCheck.error, "security audit table");

  for (const fixture of fixtures) await createAuthenticatedFixture(fixture);

  const { data: company, error: companyError } = await service
    .from("companies")
    .insert({ name: `Security fixture ${runId}` })
    .select("id")
    .single();
  expectNoError(companyError, "create company fixture");
  companyId = company.id;

  const leadFixtures = [
    { owner_id: fixtures[0].crmId, status: "sales" },
    { owner_id: fixtures[1].crmId, status: "sales" },
    { owner_id: fixtures[2].crmId, status: "sales" },
    { owner_id: fixtures[3].crmId, status: "client" },
    { owner_id: fixtures[3].crmId, status: "sales" }
  ].map((lead, index) => ({
    ...lead,
    company_id: companyId,
    source_channel: `security-test-${index}`,
    stage_order: 0
  }));
  const { error: leadsError } = await service.from("leads").insert(leadFixtures);
  expectNoError(leadsError, "create lead fixtures");

  const { data: audit, error: auditError } = await service
    .from("security_audit_log")
    .insert({
      actor_user_id: fixtures[0].crmId,
      actor_email: fixtures[0].email,
      actor_role: fixtures[0].role,
      action: "security.live_test",
      entity_type: "test_run",
      entity_id: runId
    })
    .select("id")
    .single();
  expectNoError(auditError, "create audit fixture");
  auditId = audit.id;

  const scopes = Object.fromEntries(await Promise.all(fixtures.map(async (fixture) => [fixture.key, await readScope(fixture)])));
  assert.deepEqual(scopes.owner, { role: "Руководитель", users: 4, leads: 5, audit: 1 });
  assert.deepEqual(scopes.rop, { role: "РОП", users: 4, leads: 5, audit: 1 });
  assert.deepEqual(scopes.manager, { role: "Менеджер", users: 1, leads: 1, audit: 0 });
  assert.deepEqual(scopes.account, { role: "Аккаунт-менеджер", users: 1, leads: 1, audit: 0 });

  const manager = fixtures[2];
  const ownInsert = await manager.client
    .from("leads")
    .insert({ company_id: companyId, owner_id: manager.crmId, source_channel: "security-manager-own", stage_order: 0, status: "sales" })
    .select("id")
    .single();
  expectNoError(ownInsert.error, "manager creates own lead");

  const foreignInsert = await manager.client
    .from("leads")
    .insert({ company_id: companyId, owner_id: fixtures[1].crmId, source_channel: "security-manager-foreign", stage_order: 0, status: "sales" });
  assert.ok(foreignInsert.error, "Manager must not create a lead for another employee.");

  const accountInsert = await fixtures[3].client
    .from("leads")
    .insert({ company_id: companyId, owner_id: fixtures[3].crmId, source_channel: "security-account-insert", stage_order: 0, status: "client" });
  assert.ok(accountInsert.error, "Account manager must not create leads.");

  const managerDelete = await manager.client.from("leads").delete().eq("id", ownInsert.data.id).select("id");
  expectNoError(managerDelete.error, "manager delete request");
  assert.equal(managerDelete.data.length, 0, "Manager must not delete a lead.");
  const { count: retainedLeadCount, error: retainedLeadError } = await service
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("id", ownInsert.data.id);
  expectNoError(retainedLeadError, "verify retained manager lead");
  assert.equal(retainedLeadCount, 1, "Manager lead was deleted despite RLS.");

  const disabled = await service.from("crm_users").update({ status: "disabled" }).eq("id", manager.crmId);
  expectNoError(disabled.error, "disable manager fixture");
  const disabledScope = await readScope(manager);
  assert.deepEqual(disabledScope, { role: "", users: 0, leads: 0, audit: 0 });

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "migration schema",
      "role lookup by auth.uid",
      "management visibility",
      "manager own leads only",
      "account manager active clients only",
      "lead insert/delete restrictions",
      "audit visibility",
      "disabled user lockout"
    ]
  }, null, 2));
} finally {
  await cleanup();
}
