import { applyCrmActionAsync, getCrmStateAsync } from "@/lib/crm/store";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { moscowStartOfDayIso } from "@/lib/time/moscow";

export type OptiaiEvent = {
  eventId: string;
  type: "setup_requested" | "manager_call_requested" | "account_registered" | "payment_succeeded" | "account_connected" | "subscription_expired" | "subscription_renewed" | "document_synced";
  occurredAt: string;
  data: Record<string, unknown>;
};

function text(data: Record<string, unknown>, key: string) {
  return typeof data[key] === "string" ? String(data[key]).trim() : "";
}

function eventSource(type: OptiaiEvent["type"]) {
  if (type === "setup_requested") return "OptiAI · запрос настройки";
  if (type === "manager_call_requested") return "Telegram · запрос звонка";
  if (type === "account_registered") return "OptiAI · регистрация";
  return "OptiAI · событие подписки";
}

async function findLead(event: OptiaiEvent) {
  const state = await getCrmStateAsync();
  const accountId = text(event.data, "account_id");
  const phone = text(event.data, "phone").replace(/\D/g, "");
  const email = text(event.data, "verified_email").toLowerCase();
  const telegramId = text(event.data, "telegram_id");
  return { state, lead: state.leads.find((lead) =>
    (accountId && lead.optiaiAccountId === accountId)
    || (phone.length >= 7 && lead.phone.replace(/\D/g, "") === phone)
    || (email && lead.email.toLowerCase() === email)
    || (telegramId && lead.telegramId === telegramId)
  ) };
}

async function ensureLead(event: OptiaiEvent) {
  let { lead } = await findLead(event);
  if (!lead) {
    const source = eventSource(event.type);
    await applyCrmActionAsync({
      type: "create_lead",
      payload: {
        companyName: text(event.data, "company_name") || text(event.data, "project_name") || "Новый клиент OptiAI",
        site: text(event.data, "site") || "уточнить",
        industry: text(event.data, "industry") || "уточнить",
        companySize: "уточнить",
        region: text(event.data, "region") || "уточнить",
        contactName: text(event.data, "contact_name") || "Контакт OptiAI",
        contactRole: text(event.data, "contact_role") || "ЛПР",
        phone: text(event.data, "phone") || "уточнить",
        email: text(event.data, "verified_email") || "уточнить",
        telegram: text(event.data, "telegram_username") || "уточнить",
        whatsapp: text(event.data, "whatsapp") || text(event.data, "phone") || "уточнить",
        max: text(event.data, "max_contact") || "уточнить",
        hasSeo: null, hasContext: null, hasMarketer: null, hasAgency: null,
        brandedQueries: null, llmVisibility: null, geoPotential: "Новый",
        sourceChannel: source,
        sourceDetail: event.type,
        ownerId: "",
        pain: "выявить боль",
        currentPromotionChannels: "уточнить",
        budget: "уточнить",
        nextStep: event.type === "setup_requested" ? "Связаться по запросу настройки" : "Провести первый контакт"
      }
    });
    ({ lead } = await findLead(event));
  }
  if (!lead) throw new Error("Не удалось создать или найти карточку лида");
  await applyCrmActionAsync({ type: "update_lead_operations", payload: { leadId: lead.id, changes: {
    projectName: text(event.data, "project_name"),
    optiaiAccountId: text(event.data, "account_id"),
    optiaiLogin: text(event.data, "login"),
    telegramId: text(event.data, "telegram_id"),
    whatsappContact: text(event.data, "whatsapp"),
    maxContact: text(event.data, "max_contact")
  } } });
  return { state: await getCrmStateAsync(), leadId: lead.id };
}

export async function processOptiaiEvent(event: OptiaiEvent) {
  const supabase = createServiceSupabaseClient();
  const { data: inserted, error: insertError } = await supabase.from("optiai_events").insert({
    external_event_id: event.eventId,
    event_type: event.type,
    account_id: text(event.data, "account_id") || null,
    status: "pending",
    payload: event.data,
    occurred_at: event.occurredAt
  }).select("id").maybeSingle();
  if (insertError?.code === "23505") {
    const { lead } = await findLead(event);
    return { duplicate: true, pending: event.type === "account_registered", leadId: lead?.id };
  }
  if (insertError) throw insertError;

  if (event.type === "account_registered") return { duplicate: false, pending: true };
  try {
    const { state, leadId } = await ensureLead(event);
    const lead = state.leads.find((item) => item.id === leadId)!;
    const tariff = state.tariffs.find((item) => item.id === text(event.data, "tariff_id")) ?? state.tariffs[0];
    if (event.type === "payment_succeeded" && tariff) await applyCrmActionAsync({ type: "mark_paid", payload: { leadId, tariffId: tariff.id } });
    if (event.type === "account_connected") await applyCrmActionAsync({ type: "connect_lead", payload: { leadId } });
    if (event.type === "subscription_expired") await applyCrmActionAsync({ type: "move_stage", payload: { leadId, stage: 5 } });
    if (event.type === "subscription_renewed") {
      const subscription = state.subscriptions.find((item) => item.leadId === leadId);
      if (subscription) await applyCrmActionAsync({ type: "renew_subscription", payload: { subscriptionId: subscription.id } });
      else await applyCrmActionAsync({ type: "connect_lead", payload: { leadId } });
    }
    if (event.type === "document_synced") {
      const externalId = text(event.data, "document_external_id");
      const kind = text(event.data, "document_kind");
      const title = text(event.data, "title");
      const fileUrl = text(event.data, "file_url");
      const amount = Number(event.data.amount);
      if (!externalId || !title || !["invoice", "act", "contract", "other"].includes(kind)) {
        throw new Error("Событие документа не содержит обязательные поля");
      }
      const { error: documentError } = await supabase.from("client_documents").upsert({
        lead_id: leadId,
        external_id: externalId,
        kind,
        title,
        status: text(event.data, "status") || "draft",
        file_url: fileUrl || null,
        amount: Number.isFinite(amount) ? amount : null,
        updated_at: new Date().toISOString()
      }, { onConflict: "external_id" });
      if (documentError) throw documentError;
    }
    await supabase.from("lead_source_events").upsert({ lead_id: leadId, external_event_id: event.eventId, source: eventSource(event.type), event_type: event.type, payload: event.data, occurred_at: event.occurredAt }, { onConflict: "external_event_id" });
    await supabase.from("optiai_events").update({ status: "completed", processed_at: new Date().toISOString(), attempts: 1 }).eq("id", inserted!.id);
    return { duplicate: false, pending: false, leadId, stage: lead.stage };
  } catch (error) {
    await supabase.from("optiai_events").update({ status: "failed", error: error instanceof Error ? error.message : String(error), attempts: 1 }).eq("id", inserted!.id);
    throw error;
  }
}

export async function processPendingRegistrations() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("optiai_events").select("id, external_event_id, event_type, occurred_at, payload, account_id")
    .eq("event_type", "account_registered").eq("status", "pending").lt("occurred_at", moscowStartOfDayIso()).limit(100);
  if (error?.code === "42P01" || error?.code === "PGRST205") return { created: 0, skipped: 0 };
  if (error) throw error;
  let created = 0;
  let skipped = 0;
  for (const row of data ?? []) {
    const { data: blockers } = await supabase.from("optiai_events").select("id").eq("account_id", row.account_id).in("event_type", ["setup_requested", "payment_succeeded"]).limit(1);
    if (blockers?.length) {
      await supabase.from("optiai_events").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("id", row.id);
      skipped += 1;
      continue;
    }
    const registrationEvent: OptiaiEvent = { eventId: row.external_event_id, type: "account_registered", occurredAt: row.occurred_at, data: row.payload as Record<string, unknown> };
    const { leadId } = await ensureLead(registrationEvent);
    await supabase.from("lead_source_events").upsert({ lead_id: leadId, external_event_id: row.external_event_id, source: eventSource(registrationEvent.type), event_type: registrationEvent.type, payload: registrationEvent.data, occurred_at: registrationEvent.occurredAt }, { onConflict: "external_event_id" });
    await supabase.from("optiai_events").update({ status: "completed", processed_at: new Date().toISOString() }).eq("id", row.id);
    created += 1;
  }
  return { created, skipped };
}
