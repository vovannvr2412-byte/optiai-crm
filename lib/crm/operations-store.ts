import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ClientDocument, CrmState, Lead, LeadActivationCheckCode } from "@/lib/crm/types";

function enabled() {
  if (process.env.CRM_FORCE_LOCAL === "true") return false;
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function hydrateLeadOperations(state: CrmState) {
  if (!enabled() || state.leads.length === 0) return state;
  const supabase = createServiceSupabaseClient();
  const [profiles, checks, events, documents] = await Promise.all([
    supabase.from("lead_os_profiles").select("*"),
    supabase.from("lead_activation_checks").select("*"),
    supabase.from("lead_source_events").select("id, lead_id, source, event_type, occurred_at").order("occurred_at", { ascending: false }),
    supabase.from("client_documents").select("id, lead_id, external_id, kind, title, status, file_url, amount, created_at, updated_at").order("created_at", { ascending: false })
  ]);
  const error = profiles.error ?? checks.error ?? events.error ?? documents.error;
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return state;
    throw error;
  }
  const profileByLead = new Map((profiles.data ?? []).map((row) => [String(row.lead_id), row]));
  state.leads.forEach((lead) => {
    const profile = profileByLead.get(lead.id);
    if (profile) {
      lead.projectName = String(profile.project_name ?? "");
      lead.optiaiAccountId = profile.optiai_account_id ? String(profile.optiai_account_id) : undefined;
      lead.optiaiLogin = profile.optiai_login ? String(profile.optiai_login) : undefined;
      lead.preferredChannel = (profile.preferred_channel ?? undefined) as Lead["preferredChannel"];
      lead.telegramId = profile.telegram_id ? String(profile.telegram_id) : undefined;
      lead.maxContact = profile.max_contact ? String(profile.max_contact) : undefined;
      lead.whatsappContact = profile.whatsapp_contact ? String(profile.whatsapp_contact) : undefined;
      lead.substatus = (profile.substatus ?? undefined) as Lead["substatus"];
      lead.expectedPaymentAt = profile.expected_payment_at ? String(profile.expected_payment_at) : undefined;
      lead.originalOwnerId = profile.original_owner_id ? String(profile.original_owner_id) : undefined;
      lead.scriptsSent = Boolean(profile.scripts_sent);
      lead.scriptsSentAt = profile.scripts_sent_at ? String(profile.scripts_sent_at) : undefined;
    }
    lead.activationChecks = (checks.data ?? []).filter((row) => row.lead_id === lead.id).map((row) => ({ code: row.code as LeadActivationCheckCode, completedAt: row.completed_at ? String(row.completed_at) : undefined, completedBy: row.completed_by ? String(row.completed_by) : undefined, notApplicable: Boolean(row.not_applicable) }));
    lead.sourceHistory = (events.data ?? []).filter((row) => row.lead_id === lead.id).map((row) => ({ id: String(row.id), source: String(row.source), eventType: String(row.event_type), occurredAt: String(row.occurred_at) }));
  });
  state.clientDocuments = (documents.data ?? []).map((row) => ({
    id: String(row.id),
    leadId: String(row.lead_id),
    externalId: row.external_id ? String(row.external_id) : undefined,
    kind: String(row.kind) as ClientDocument["kind"],
    title: String(row.title),
    status: String(row.status),
    fileUrl: row.file_url ? String(row.file_url) : undefined,
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }));
  return state;
}

export async function saveLeadOperations(lead: Lead, actorId?: string) {
  if (!enabled()) return;
  const { error } = await createServiceSupabaseClient().from("lead_os_profiles").upsert({
    lead_id: lead.id,
    project_name: lead.projectName ?? "",
    optiai_account_id: lead.optiaiAccountId || null,
    optiai_login: lead.optiaiLogin || null,
    preferred_channel: lead.preferredChannel || null,
    telegram_id: lead.telegramId || null,
    max_contact: lead.maxContact || null,
    whatsapp_contact: lead.whatsappContact || null,
    substatus: lead.substatus || null,
    expected_payment_at: lead.expectedPaymentAt || null,
    original_owner_id: lead.originalOwnerId || lead.ownerId,
    scripts_sent: Boolean(lead.scriptsSent),
    scripts_sent_at: lead.scriptsSentAt || null,
    scripts_sent_by: lead.scriptsSent ? actorId ?? null : null,
    updated_at: new Date().toISOString()
  }, { onConflict: "lead_id" });
  if (error) throw error;
}

export async function saveActivationCheck(input: { leadId: string; code: LeadActivationCheckCode; completed: boolean; notApplicable?: boolean; actorId: string }) {
  if (!enabled()) return;
  const { error } = await createServiceSupabaseClient().from("lead_activation_checks").upsert({
    lead_id: input.leadId,
    code: input.code,
    completed_at: input.completed ? new Date().toISOString() : null,
    completed_by: input.completed ? input.actorId : null,
    not_applicable: Boolean(input.notApplicable)
  }, { onConflict: "lead_id,code" });
  if (error) throw error;
}
