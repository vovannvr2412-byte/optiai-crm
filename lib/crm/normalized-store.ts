import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { CrmState } from "./types";

const migrationMarkerKey = "normalized_storage_v1";
const legacyStateKey = "crm_state";
const backupStateKey = "crm_state_backup_v1";

type ExistingRow = { id: string; [key: string]: unknown };
type IdMaps = {
  users: Map<string, string>;
  tariffs: Map<string, string>;
  leads: Map<string, string>;
  tasks: Map<string, string>;
  activities: Map<string, string>;
  calls: Map<string, string>;
  subscriptions: Map<string, string>;
  payments: Map<string, string>;
  sequences: Map<string, string>;
  steps: Map<string, string>;
};

function stableUuid(kind: string, sourceId: string) {
  const hex = createHash("sha256").update(`optiai-crm:${kind}:${sourceId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function remap(map: Map<string, string>, kind: string, sourceId: string) {
  const current = map.get(sourceId);
  if (current) return current;
  const next = stableUuid(kind, sourceId);
  map.set(sourceId, next);
  return next;
}

function makeMaps(): IdMaps {
  return {
    users: new Map(), tariffs: new Map(), leads: new Map(), tasks: new Map(), activities: new Map(),
    calls: new Map(), subscriptions: new Map(), payments: new Map(), sequences: new Map(), steps: new Map()
  };
}

function normalizedState(legacy: CrmState, existingUsers: ExistingRow[], existingTariffs: ExistingRow[], existingSequences: ExistingRow[]) {
  const maps = makeMaps();
  const usersByEmail = new Map(existingUsers.map((row) => [String(row.email).toLowerCase(), row.id]));
  const tariffsByName = new Map(existingTariffs.map((row) => [String(row.name), row.id]));
  const sequencesByName = new Map(existingSequences.map((row) => [String(row.name), row.id]));

  legacy.users.forEach((user) => maps.users.set(user.id, usersByEmail.get(user.email.toLowerCase()) ?? stableUuid("user", user.id)));
  legacy.tariffs.forEach((tariff) => maps.tariffs.set(tariff.id, tariffsByName.get(tariff.name) ?? stableUuid("tariff", tariff.id)));
  legacy.leads.forEach((lead) => maps.leads.set(lead.id, stableUuid("lead", lead.id)));
  legacy.tasks.forEach((task) => maps.tasks.set(task.id, stableUuid("task", task.id)));
  legacy.activities.forEach((activity) => maps.activities.set(activity.id, stableUuid("activity", activity.id)));
  legacy.callRecords.forEach((call) => maps.calls.set(call.id, stableUuid("call", call.id)));
  legacy.subscriptions.forEach((subscription) => maps.subscriptions.set(subscription.id, stableUuid("subscription", subscription.id)));
  legacy.payments.forEach((payment) => maps.payments.set(payment.id, stableUuid("payment", payment.id)));
  legacy.warmupSequences.forEach((sequence) => {
    maps.sequences.set(sequence.id, sequencesByName.get(sequence.name) ?? stableUuid("warmup-sequence", sequence.id));
    sequence.steps.forEach((step) => maps.steps.set(step.id, stableUuid("warmup-step", step.id)));
  });

  const state: CrmState = {
    users: legacy.users.map((user) => ({ ...user, id: remap(maps.users, "user", user.id) })),
    tariffs: legacy.tariffs.map((tariff) => ({ ...tariff, id: remap(maps.tariffs, "tariff", tariff.id) })),
    leads: legacy.leads.map((lead) => ({
      ...lead,
      id: remap(maps.leads, "lead", lead.id),
      ownerId: remap(maps.users, "user", lead.ownerId),
      tariffId: lead.tariffId ? remap(maps.tariffs, "tariff", lead.tariffId) : undefined
    })),
    tasks: legacy.tasks.map((task) => ({
      ...task,
      id: remap(maps.tasks, "task", task.id),
      leadId: remap(maps.leads, "lead", task.leadId),
      ownerId: remap(maps.users, "user", task.ownerId)
    })),
    activities: legacy.activities.map((activity) => ({
      ...activity,
      id: remap(maps.activities, "activity", activity.id),
      leadId: remap(maps.leads, "lead", activity.leadId)
    })),
    callRecords: legacy.callRecords.map((call) => ({
      ...call,
      id: remap(maps.calls, "call", call.id),
      leadId: remap(maps.leads, "lead", call.leadId),
      ownerId: remap(maps.users, "user", call.ownerId)
    })),
    subscriptions: legacy.subscriptions.map((subscription) => ({
      ...subscription,
      id: remap(maps.subscriptions, "subscription", subscription.id),
      leadId: remap(maps.leads, "lead", subscription.leadId),
      tariffId: remap(maps.tariffs, "tariff", subscription.tariffId)
    })),
    payments: legacy.payments.map((payment) => ({
      ...payment,
      id: remap(maps.payments, "payment", payment.id),
      leadId: remap(maps.leads, "lead", payment.leadId)
    })),
    warmupSequences: legacy.warmupSequences.map((sequence) => ({
      ...sequence,
      id: remap(maps.sequences, "warmup-sequence", sequence.id),
      steps: sequence.steps.map((step) => ({ ...step, id: remap(maps.steps, "warmup-step", step.id) }))
    })),
    integrations: structuredClone(legacy.integrations)
  };

  return { state, maps };
}

async function appStateValue<T>(key: string) {
  const { data, error } = await createServiceSupabaseClient().from("crm_app_state").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return (data?.value ?? null) as T | null;
}

async function setAppStateValue(key: string, value: unknown) {
  const { error } = await createServiceSupabaseClient().from("crm_app_state").upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });
  if (error) throw error;
}

export async function readNormalizedCrmState() {
  const { data, error } = await createServiceSupabaseClient().rpc("get_crm_state_normalized");
  if (error) throw new Error(`Не применена миграция 0004_normalized_crm_and_auth.sql: ${error.message}`);
  return data as CrmState;
}

export async function writeNormalizedCrmState(state: CrmState) {
  const { error } = await createServiceSupabaseClient().rpc("save_crm_state_normalized", { p_state: state });
  if (error) throw new Error(`Не удалось сохранить нормализованные данные CRM: ${error.message}`);
}

async function updateMessengerReferences(maps: IdMaps) {
  const supabase = createServiceSupabaseClient();
  for (const [oldId, nextId] of maps.leads) {
    if (oldId === nextId) continue;
    const { error } = await supabase.from("messenger_conversations").update({ lead_id: nextId }).eq("lead_id", oldId);
    if (error) throw error;
  }
  for (const [oldId, nextId] of maps.users) {
    if (oldId === nextId) continue;
    const { error } = await supabase.from("messenger_conversations").update({ owner_id: nextId }).eq("owner_id", oldId);
    if (error) throw error;
  }
}

export async function ensureNormalizedCrmState(fallback: CrmState) {
  const marker = await appStateValue<{ completedAt?: string }>(migrationMarkerKey);
  if (marker?.completedAt) return readNormalizedCrmState();

  const legacy = await appStateValue<CrmState>(legacyStateKey) ?? fallback;
  const supabase = createServiceSupabaseClient();
  const [usersResult, tariffsResult, sequencesResult] = await Promise.all([
    supabase.from("crm_users").select("id,email"),
    supabase.from("tariffs").select("id,name"),
    supabase.from("warmup_sequences").select("id,name")
  ]);
  if (usersResult.error) throw usersResult.error;
  if (tariffsResult.error) throw tariffsResult.error;
  if (sequencesResult.error) throw sequencesResult.error;

  const { state, maps } = normalizedState(
    legacy,
    (usersResult.data ?? []) as ExistingRow[],
    (tariffsResult.data ?? []) as ExistingRow[],
    (sequencesResult.data ?? []) as ExistingRow[]
  );

  if (!await appStateValue(backupStateKey)) await setAppStateValue(backupStateKey, legacy);
  await writeNormalizedCrmState(state);
  await updateMessengerReferences(maps);
  await setAppStateValue(migrationMarkerKey, {
    completedAt: new Date().toISOString(),
    source: legacyStateKey,
    backup: backupStateKey,
    counts: {
      users: state.users.length,
      leads: state.leads.length,
      tasks: state.tasks.length,
      activities: state.activities.length
    }
  });
  return readNormalizedCrmState();
}
