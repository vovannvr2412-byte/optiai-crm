import { GoogleAuth } from "google-auth-library";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { applyCrmActionsAsync, getCrmStateAsync, setIntegrationStatusAsync, supabasePersistenceEnabled } from "@/lib/crm/store";
import { getIntegrationSecrets, getIntegrationSecretPresence, saveIntegrationSecrets } from "@/lib/integrations/secrets";
import { STAGES, type CrmAction, type CrmUser, type Lead } from "@/lib/crm/types";

export const externalIntegrationDefinitions = {
  sheets: {
    name: "Google Sheets",
    fields: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SPREADSHEET_ID", "GOOGLE_SHEET_RANGE"] as const,
    required: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SPREADSHEET_ID"] as const
  },
  metrika: {
    name: "Яндекс Метрика",
    fields: ["YANDEX_METRIKA_OAUTH_TOKEN", "YANDEX_METRIKA_COUNTER_ID", "YANDEX_METRIKA_GOAL_ID", "YANDEX_METRIKA_USER_ID_SOURCE"] as const,
    required: ["YANDEX_METRIKA_OAUTH_TOKEN", "YANDEX_METRIKA_COUNTER_ID", "YANDEX_METRIKA_GOAL_ID"] as const
  }
};

export type ExternalIntegrationId = keyof typeof externalIntegrationDefinitions;

export function isExternalIntegrationId(value: string): value is ExternalIntegrationId {
  return value in externalIntegrationDefinitions;
}

async function resolvedSecrets(id: ExternalIntegrationId) {
  const stored = await getIntegrationSecrets(id);
  return Object.fromEntries(externalIntegrationDefinitions[id].fields.map((field) => [field, stored[field] || process.env[field]?.trim() || ""]));
}

export async function externalIntegrationSummary(id: ExternalIntegrationId) {
  const definition = externalIntegrationDefinitions[id];
  const configuredFields = await getIntegrationSecretPresence(id, definition.fields);
  const configured = definition.required.every((field) => configuredFields[field]);
  let lastRun: Record<string, unknown> | null = null;
  if (supabasePersistenceEnabled()) {
    const { data, error } = await createServiceSupabaseClient().from("integration_sync_runs").select("*").eq("integration_id", id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (!error) lastRun = data as Record<string, unknown> | null;
  }
  return { id, name: definition.name, configured, configuredFields, lastRun };
}

export async function saveExternalIntegration(id: ExternalIntegrationId, updates: Record<string, string>) {
  const allowed = new Set<string>(externalIntegrationDefinitions[id].fields);
  await saveIntegrationSecrets(id, Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.has(key))));
  try {
    const result = await checkExternalIntegration(id);
    await setIntegrationStatusAsync(id, result.ok ? "connected" : "error");
    return result;
  } catch (error) {
    await setIntegrationStatusAsync(id, "error");
    throw error;
  }
}

export async function checkExternalIntegration(id: ExternalIntegrationId) {
  const runId = await beginRun(id, "check");
  try {
    const result = id === "sheets" ? await checkGoogleSheets() : await checkYandexMetrika();
    await finishRun(runId, "completed", { details: result });
    return { ok: true, ...result };
  } catch (error) {
    const message = cleanError(error);
    await finishRun(runId, "failed", { error: message });
    return { ok: false, message };
  }
}

export async function syncExternalIntegration(id: ExternalIntegrationId, user: CrmUser | null) {
  const runId = await beginRun(id, "bidirectional", user?.id);
  try {
    const result = id === "sheets" ? await syncGoogleSheets() : await syncYandexMetrika();
    await finishRun(runId, "completed", { recordsRead: result.recordsRead, recordsWritten: result.recordsWritten, details: result });
    await setIntegrationStatusAsync(id, "connected");
    return result;
  } catch (error) {
    const message = cleanError(error);
    await finishRun(runId, "failed", { error: message });
    await setIntegrationStatusAsync(id, "error");
    throw new Error(message);
  }
}

export async function syncScheduledExternalIntegrations() {
  const results: Array<{ id: ExternalIntegrationId; status: "completed" | "failed" | "skipped"; message: string }> = [];
  for (const id of Object.keys(externalIntegrationDefinitions) as ExternalIntegrationId[]) {
    const summary = await externalIntegrationSummary(id);
    if (!summary.configured) {
      results.push({ id, status: "skipped", message: "Интеграция не настроена." });
      continue;
    }
    try {
      const result = await syncExternalIntegration(id, null);
      results.push({ id, status: "completed", message: result.message });
    } catch (error) {
      results.push({ id, status: "failed", message: cleanError(error) });
    }
  }
  return results;
}

async function googleAccess() {
  const config = await resolvedSecrets("sheets");
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON || !config.GOOGLE_SPREADSHEET_ID) throw new Error("Добавьте JSON сервисного аккаунта и Spreadsheet ID.");
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("Service Account JSON содержит некорректный JSON.");
  }
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Google не выдал access token сервисному аккаунту.");
  return {
    token,
    spreadsheetId: config.GOOGLE_SPREADSHEET_ID,
    range: config.GOOGLE_SHEET_RANGE || "CRM!A:V"
  };
}

async function googleJson(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(String((data?.error as Record<string, unknown> | undefined)?.message || `Google Sheets HTTP ${response.status}`));
  return data;
}

async function checkGoogleSheets() {
  const { token, spreadsheetId } = await googleAccess();
  const data = await googleJson(`/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title`, token);
  return { message: `Таблица «${String((data?.properties as Record<string, unknown> | undefined)?.title || spreadsheetId)}» доступна.`, externalId: spreadsheetId };
}

const sheetHeaders = [
  "CRM_ID", "Компания", "Сайт", "Отрасль", "Размер", "Регион", "Контакт", "Должность", "Телефон", "Email",
  "Telegram", "WhatsApp", "MAX", "Канал", "Детали", "Этап", "Причина отказа", "Ответственный email", "Бюджет", "Боль", "Следующий шаг", "Обновлено"
];

async function syncGoogleSheets() {
  const { token, spreadsheetId, range } = await googleAccess();
  const encodedRange = encodeURIComponent(range);
  const current = await googleJson(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}`, token);
  const values = Array.isArray(current?.values) ? current.values as unknown[][] : [];
  let imported = 0;
  if (values.length > 1) imported = await importSheetRows(values);
  const state = await getCrmStateAsync();
  const rows = [sheetHeaders, ...state.leads.map((lead) => leadToSheetRow(lead, state.users.find((user) => user.id === lead.ownerId)?.email || ""))];
  await googleJson(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}:clear`, token, { method: "POST", body: "{}" });
  await googleJson(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?valueInputOption=RAW`, token, {
    method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values: rows })
  });
  return { recordsRead: Math.max(0, values.length - 1), recordsWritten: state.leads.length, imported, exported: state.leads.length, message: `Импортировано: ${imported}. В таблицу записано лидов: ${state.leads.length}.` };
}

async function importSheetRows(values: unknown[][]) {
  const headers = values[0].map((value) => String(value).trim());
  const index = new Map(headers.map((header, position) => [header, position]));
  if (!index.has("Компания") || !index.has("Телефон")) throw new Error("В таблице нужны колонки «Компания» и «Телефон». Используйте отдельный лист CRM.");
  const state = await getCrmStateAsync();
  const actions: CrmAction[] = [];
  const pendingStages = new Map<string, { stage: number; refusalReason?: string }>();
  const newPhones = new Set<string>();
  let imported = 0;
  for (const rawRow of values.slice(1, 501)) {
    const cell = (header: string) => String(rawRow[index.get(header) ?? -1] ?? "").trim();
    const companyName = cell("Компания");
    const phone = cell("Телефон");
    if (!companyName || !phone) continue;
    const crmId = cell("CRM_ID");
    const existing = state.leads.find((lead) => lead.id === crmId) ?? state.leads.find((lead) => lead.phone === phone);
    const owner = state.users.find((user) => user.email.toLowerCase() === cell("Ответственный email").toLowerCase() && user.status === "active")
      ?? state.users.find((user) => user.status === "active" && (user.role === "Менеджер" || user.role === "РОП" || user.role === "Руководитель"));
    if (!owner) throw new Error("В CRM нет активного сотрудника для назначения импортируемых лидов.");
    const stageName = cell("Этап");
    const stage = Math.max(0, STAGES.findIndex((item) => item === stageName));
    if (existing) {
      actions.push({ type: "update_lead", payload: { leadId: existing.id, changes: {
        companyName, phone, site: cell("Сайт") || existing.site, industry: cell("Отрасль") || existing.industry,
        companySize: cell("Размер") || existing.companySize, region: cell("Регион") || existing.region,
        contactName: cell("Контакт") || existing.contactName, contactRole: cell("Должность") || existing.contactRole,
        email: cell("Email") || existing.email, telegram: cell("Telegram") || existing.telegram,
        whatsapp: cell("WhatsApp") || existing.whatsapp, max: cell("MAX") || existing.max,
        sourceChannel: cell("Канал") || existing.sourceChannel, sourceDetail: cell("Детали") || existing.sourceDetail,
        stage: stageName ? stage : existing.stage, refusalReason: cell("Причина отказа") || existing.refusalReason,
        ownerId: owner.id, budget: cell("Бюджет") || existing.budget,
        pain: cell("Боль") || existing.pain, nextStep: cell("Следующий шаг") || existing.nextStep
      } } });
    } else {
      if (newPhones.has(phone)) continue;
      newPhones.add(phone);
      actions.push({ type: "create_lead", payload: {
        companyName, site: cell("Сайт") || "уточнить", industry: cell("Отрасль") || "уточнить",
        companySize: cell("Размер") || "уточнить", region: cell("Регион") || "уточнить",
        contactName: cell("Контакт") || companyName, contactRole: cell("Должность") || "ЛПР", phone,
        email: cell("Email") || "уточнить", telegram: cell("Telegram") || "уточнить",
        whatsapp: cell("WhatsApp") || phone, max: cell("MAX") || "уточнить", hasSeo: null, hasContext: null,
        hasMarketer: null, hasAgency: null, brandedQueries: null, llmVisibility: null, geoPotential: "Новый",
        sourceChannel: cell("Канал") || "Google Sheets", sourceDetail: cell("Детали") || "двусторонняя синхронизация",
        ownerId: owner.id, pain: cell("Боль"), currentPromotionChannels: "", budget: cell("Бюджет"),
        nextStep: cell("Следующий шаг") || "Связаться с лидом"
      } });
      if (stageName && stage > 0) {
        pendingStages.set(phone, {
          stage,
          refusalReason: stage === 6 ? cell("Причина отказа") || "Отказ импортирован из Google Sheets" : undefined
        });
      }
    }
    imported += 1;
  }
  const afterImport = actions.length ? await applyCrmActionsAsync(actions) : state;
  const stageActions: CrmAction[] = [];
  for (const [phone, changes] of pendingStages) {
    const lead = afterImport.leads.find((item) => item.phone === phone);
    if (lead) stageActions.push({ type: "update_lead", payload: { leadId: lead.id, changes } });
  }
  if (stageActions.length) await applyCrmActionsAsync(stageActions);
  return imported;
}

function leadToSheetRow(lead: Lead, ownerEmail: string) {
  return [lead.id, lead.companyName, lead.site, lead.industry, lead.companySize, lead.region, lead.contactName, lead.contactRole,
    lead.phone, lead.email, lead.telegram, lead.whatsapp, lead.max, lead.sourceChannel, lead.sourceDetail, STAGES[lead.stage],
    lead.refusalReason || "", ownerEmail, lead.budget, lead.pain, lead.nextStep, new Date().toISOString()];
}

async function metrikaConfiguration() {
  const config = await resolvedSecrets("metrika");
  if (!config.YANDEX_METRIKA_OAUTH_TOKEN || !config.YANDEX_METRIKA_COUNTER_ID || !config.YANDEX_METRIKA_GOAL_ID) {
    throw new Error("Добавьте OAuth Token, Counter ID и Goal ID Яндекс Метрики.");
  }
  return {
    token: config.YANDEX_METRIKA_OAUTH_TOKEN,
    counterId: config.YANDEX_METRIKA_COUNTER_ID,
    goalId: config.YANDEX_METRIKA_GOAL_ID,
    identifierSource: config.YANDEX_METRIKA_USER_ID_SOURCE || "lead_id"
  };
}

async function yandexJson(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `OAuth ${token}`, ...(init.headers ?? {}) }, cache: "no-store" });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const firstError = (data?.errors as Array<{ message?: string }> | undefined)?.[0];
    throw new Error(firstError?.message || String(data?.message || `Яндекс Метрика HTTP ${response.status}`));
  }
  return data;
}

async function checkYandexMetrika() {
  const { token, counterId } = await metrikaConfiguration();
  const data = await yandexJson(`https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(counterId)}`, token);
  const counter = data?.counter as Record<string, unknown> | undefined;
  return { message: `Счётчик «${String(counter?.name || counterId)}» доступен.`, externalId: counterId };
}

async function syncYandexMetrika() {
  if (!supabasePersistenceEnabled()) throw new Error("Обмен с Яндекс Метрикой требует Supabase для защиты от дублей.");
  const { token, counterId, goalId, identifierSource } = await metrikaConfiguration();
  const state = await getCrmStateAsync();
  const supabase = createServiceSupabaseClient();
  const { data: exported, error } = await supabase.from("integration_export_events").select("event_key").eq("integration_id", "metrika");
  if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Выполните миграцию 0008_external_integrations_and_web_push.sql." : error.message);
  const exportedKeys = new Set((exported ?? []).map((row) => String(row.event_key)));
  const pending = state.payments.filter((payment) => payment.status === "paid" && !exportedKeys.has(`payment:${payment.id}`));
  let uploadId = "";
  if (pending.length) {
    const header = "UserId,Target,DateTime,Price,Currency";
    const rows = pending.map((payment) => {
      const lead = state.leads.find((item) => item.id === payment.leadId);
      if (!lead) throw new Error(`Для платежа ${payment.id} не найден лид.`);
      const userId = identifierSource === "email" ? lead.email : identifierSource === "phone" ? lead.phone : lead.id;
      const timestamp = Math.floor(Date.parse(`${payment.paidAt}T12:00:00Z`) / 1000);
      return [csv(userId), csv(goalId), timestamp, payment.amount, "RUB"].join(",");
    });
    const form = new FormData();
    form.append("file", new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" }), "optiai-conversions.csv");
    const upload = await yandexJson(`https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(counterId)}/offline_conversions/upload`, token, { method: "POST", body: form });
    uploadId = String((upload?.uploading as Record<string, unknown> | undefined)?.id || upload?.id || "");
    const { error: saveError } = await supabase.from("integration_export_events").insert(pending.map((payment) => ({
      integration_id: "metrika", event_key: `payment:${payment.id}`, external_id: uploadId || null
    })));
    if (saveError) throw saveError;
  }
  const reportUrl = new URL("https://api-metrika.yandex.net/stat/v1/data");
  reportUrl.searchParams.set("ids", counterId);
  reportUrl.searchParams.set("metrics", "ym:s:visits,ym:s:users");
  reportUrl.searchParams.set("date1", "30daysAgo");
  reportUrl.searchParams.set("date2", "today");
  const report = await yandexJson(reportUrl.toString(), token);
  const totals = Array.isArray(report?.totals) ? report.totals.map(Number) : [];
  return {
    recordsRead: Number(totals[0] || 0), recordsWritten: pending.length, uploadId,
    visits30d: Number(totals[0] || 0), users30d: Number(totals[1] || 0),
    message: pending.length ? `Передано оплаченных конверсий: ${pending.length}.` : "Новых оплаченных конверсий для передачи нет."
  };
}

function csv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function beginRun(integrationId: string, direction: string, initiatedBy?: string) {
  if (!supabasePersistenceEnabled()) return null;
  const { data, error } = await createServiceSupabaseClient().from("integration_sync_runs").insert({
    integration_id: integrationId, direction, initiated_by: initiatedBy ?? null, status: "running"
  }).select("id").single();
  if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Выполните миграцию 0008_external_integrations_and_web_push.sql." : error.message);
  return String(data.id);
}

async function finishRun(runId: string | null, status: "completed" | "failed", input: { recordsRead?: number; recordsWritten?: number; details?: unknown; error?: string }) {
  if (!runId) return;
  await createServiceSupabaseClient().from("integration_sync_runs").update({
    status, records_read: input.recordsRead ?? 0, records_written: input.recordsWritten ?? 0,
    details: input.details ?? {}, error: input.error ?? null, completed_at: new Date().toISOString()
  }).eq("id", runId);
}

function cleanError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+\S+/gi, "Bearer [скрыто]").replace(/OAuth\s+\S+/gi, "OAuth [скрыто]").slice(0, 800);
}
