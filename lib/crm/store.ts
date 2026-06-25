import { createSeedState } from "./seed";
import { disableCredential, getCredentialsSnapshot, hydrateCredentialsSnapshot, registerCredential } from "@/lib/auth/credentials";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { STAGES, type CrmAction, type CrmState, type Lead, type LeadTemperature, type Role } from "./types";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const globalForCrm = globalThis as unknown as { optiCrmState?: CrmState };
const dataDir = process.env.CRM_DATA_DIR || path.join(process.cwd(), "data");
const stateFile = path.join(dataDir, "crm-state.json");
const tempStateFile = path.join(dataDir, "crm-state.tmp.json");
const retiredSeedUserIds = new Set(["u-anna", "u-sofia", "u-ilya"]);
const retiredSeedUserEmails = ["anna@optiai.ru", "sofia@optiai.ru", "ilya@optiai.ru"];
const crmStateKey = "crm_state";
const credentialsKey = "credentials";
let suppressLocalPersistence = false;

function supabasePersistenceEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function readSupabaseValue<T>(key: string) {
  if (!supabasePersistenceEnabled()) return null;
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("crm_app_state").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return (data?.value ?? null) as T | null;
}

async function writeSupabaseValue(key: string, value: unknown) {
  if (!supabasePersistenceEnabled()) return;
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("crm_app_state").upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });
  if (error) throw error;
}

function readPersistedState() {
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as CrmState;
  } catch {
    return null;
  }
}

function persistState(state: CrmState) {
  mkdirSync(dataDir, { recursive: true });
  const serialized = JSON.stringify(state, null, 2);
  writeFileSync(tempStateFile, serialized, "utf8");
  renameSync(tempStateFile, stateFile);
  const verification = JSON.parse(readFileSync(stateFile, "utf8")) as CrmState;
  if (verification.users.length !== state.users.length || verification.leads.length !== state.leads.length) {
    throw new Error("CRM state was not persisted correctly");
  }
}

function migrateState(state: CrmState) {
  let changed = false;
  const retiredUsers = state.users.filter((user) => retiredSeedUserIds.has(user.id));
  if (retiredUsers.length === 0) return { state, changed };

  const retiredIds = new Set(retiredUsers.map((user) => user.id));
  const fallback = state.users.find((user) => user.role === "РОП" && user.status === "active" && !retiredIds.has(user.id))
    ?? state.users.find((user) => user.role === "Руководитель" && user.status === "active");

  state.leads.forEach((lead) => {
    if (retiredIds.has(lead.ownerId)) {
      lead.ownerId = fallback?.id ?? "";
      changed = true;
    }
  });
  state.tasks = state.tasks.filter((task) => !retiredIds.has(task.ownerId));
  state.callRecords = state.callRecords.filter((call) => !retiredIds.has(call.ownerId));
  state.users = state.users.filter((user) => !retiredIds.has(user.id));
  retiredSeedUserEmails.forEach((email) => disableCredential(email));
  return { state, changed: true };
}

function isCrmState(value: unknown): value is CrmState {
  return Boolean(
    value
      && typeof value === "object"
      && Array.isArray((value as CrmState).users)
      && Array.isArray((value as CrmState).leads)
      && Array.isArray((value as CrmState).tasks)
      && Array.isArray((value as CrmState).integrations)
  );
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function today() {
  return new Date().toISOString();
}

function dateOnly(daysFromNow = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

export function getCrmState(): CrmState {
  const migrated = migrateState(readPersistedState() ?? createSeedState());
  globalForCrm.optiCrmState = migrated.state;
  if (migrated.changed || !existsSync(stateFile)) persistState(globalForCrm.optiCrmState);
  return globalForCrm.optiCrmState;
}

export async function getCrmStateAsync(): Promise<CrmState> {
  if (!supabasePersistenceEnabled()) return getCrmState();

  const [storedState, storedCredentials] = await Promise.all([
    readSupabaseValue<CrmState>(crmStateKey),
    readSupabaseValue<ReturnType<typeof getCredentialsSnapshot>>(credentialsKey)
  ]);

  if (storedCredentials) hydrateCredentialsSnapshot(storedCredentials);

  const validStoredState = isCrmState(storedState) ? storedState : null;
  const migrated = migrateState(validStoredState ?? createSeedState());
  globalForCrm.optiCrmState = migrated.state;
  if (!storedState || migrated.changed) {
    await persistCrmStateAsync(globalForCrm.optiCrmState);
  }
  return globalForCrm.optiCrmState;
}

async function persistCrmStateAsync(state: CrmState) {
  if (!supabasePersistenceEnabled()) {
    persistState(state);
  }
  await Promise.all([
    writeSupabaseValue(crmStateKey, state),
    writeSupabaseValue(credentialsKey, getCredentialsSnapshot())
  ]);
}

export function resetCrmState() {
  globalForCrm.optiCrmState = createSeedState();
  persistState(globalForCrm.optiCrmState);
  return getCrmState();
}

export function cloneState() {
  return structuredClone(getCrmState());
}

export async function cloneStateAsync() {
  return structuredClone(await getCrmStateAsync());
}

export function scoreLead(lead: Pick<Lead, "companySize" | "hasSeo" | "hasContext" | "hasMarketer" | "brandedQueries" | "llmVisibility" | "budget" | "stage">) {
  let score = 20;
  const size = parseInt(lead.companySize.replace(/\D/g, ""), 10);
  if (!Number.isNaN(size)) score += size >= 100 ? 18 : size >= 40 ? 12 : 6;
  if (lead.hasContext) score += 10;
  if (lead.hasSeo) score += 8;
  if (lead.hasMarketer) score += 8;
  if ((lead.brandedQueries ?? 0) >= 5000) score += 14;
  if ((lead.llmVisibility ?? 0) < 10) score += 8;
  if (lead.budget.includes("100") || lead.budget.includes("150") || lead.budget.includes("180")) score += 10;
  if (lead.stage >= 4) score += 8;
  return Math.min(100, score);
}

export function temperature(score: number): LeadTemperature {
  if (score >= 80) return "hot";
  if (score >= 50) return "warm";
  return "cold";
}

export function scopedStateFor(userId: string): CrmState {
  const state = cloneState();
  return scopeState(state, userId);
}

export async function scopedStateForAsync(userId: string): Promise<CrmState> {
  const state = await cloneStateAsync();
  return scopeState(state, userId);
}

function scopeState(state: CrmState, userId: string): CrmState {
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.role === "Руководитель" || user.role === "РОП") return state;
  if (user.role === "Менеджер") {
    const allowedLeadIds = new Set(state.leads.filter((lead) => lead.ownerId === user.id).map((lead) => lead.id));
    return filterStateByLeads(state, allowedLeadIds, user.role);
  }
  const allowedLeadIds = new Set(state.leads.filter((lead) => lead.ownerId === user.id && lead.status === "client").map((lead) => lead.id));
  return filterStateByLeads(state, allowedLeadIds, user.role);
}

function filterStateByLeads(state: CrmState, leadIds: Set<string>, role: Role): CrmState {
  return {
    ...state,
    leads: state.leads.filter((lead) => leadIds.has(lead.id)),
    subscriptions: state.subscriptions.filter((subscription) => leadIds.has(subscription.leadId)),
    payments: state.payments.filter((payment) => leadIds.has(payment.leadId)),
    tasks: state.tasks.filter((task) => leadIds.has(task.leadId)),
    activities: state.activities.filter((activity) => leadIds.has(activity.leadId)),
    callRecords: state.callRecords.filter((call) => leadIds.has(call.leadId)),
    users: role === "Менеджер" || role === "Аккаунт-менеджер" ? state.users.filter((user) => user.role !== "Руководитель") : state.users
  };
}

function addActivity(state: CrmState, leadId: string, type: CrmState["activities"][number]["type"], title: string, detail: string) {
  state.activities.unshift({ id: id("act"), leadId, type, title, detail, createdAt: today() });
}

function addTask(state: CrmState, leadId: string, ownerId: string, title: string, daysFromNow: number, priority: "high" | "medium" | "low", automationKey?: string) {
  state.tasks.unshift({ id: id("task"), leadId, ownerId, title, dueAt: dateOnly(daysFromNow), priority, status: "open", automationKey });
}

function scheduleNoAnswerFollowUps(state: CrmState, lead: Lead, ownerId: string) {
  state.tasks = state.tasks.filter((task) => !(task.leadId === lead.id && task.automationKey === "missed_call" && task.status === "open"));
  [
    { days: 1, priority: "high" as const },
    { days: 3, priority: "medium" as const },
    { days: 7, priority: "medium" as const }
  ].forEach(({ days, priority }) => {
    const dayLabel = days === 1 ? "день" : days === 3 ? "дня" : "дней";
    addTask(state, lead.id, ownerId, `Перезвонить через ${days} ${dayLabel}`, days, priority, "missed_call");
    addActivity(state, lead.id, "task", `Уведомление: перезвон через ${days} ${dayLabel}`, `CRM поставила задачу ответственному: ${dateLabelForTask(days)}.`);
  });
}

function dateLabelForTask(daysFromNow: number) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(dateOnly(daysFromNow)));
}

export function applyCrmAction(action: CrmAction): CrmState {
  const state = getCrmState();

  if (action.type === "create_user") {
    const newUser = {
      id: id("user"),
      fullName: action.payload.fullName,
      email: action.payload.email,
      role: action.payload.role,
      position: action.payload.position,
      status: "active" as const,
      calls: 0,
      meetings: 0,
      revenue: 0,
      conversion: 0,
      createdAt: today()
    };
    state.users.unshift(newUser);
    registerCredential(newUser.id, newUser.email, action.payload.password);
  }

  if (action.type === "disable_user") {
    const user = state.users.find((item) => item.id === action.payload.userId);
    const fallback = state.users.find((item) => item.role === "Менеджер" && item.status === "active" && item.id !== user?.id);
    if (user && user.role !== "Руководитель") {
      user.status = "disabled";
      disableCredential(user.email);
      if (fallback) {
        state.leads.filter((lead) => lead.ownerId === user.id).forEach((lead) => {
          lead.ownerId = fallback.id;
          addActivity(state, lead.id, "system", "Ответственный изменен", `Аккаунт ${user.fullName} отключен, сделка передана ${fallback.fullName}.`);
        });
      }
    }
  }

  if (action.type === "delete_user") {
    const user = state.users.find((item) => item.id === action.payload.userId);
    if (user && user.role !== "Руководитель") {
      const fallback = state.users.find((item) => item.role === "РОП" && item.status === "active" && item.id !== user.id)
        ?? state.users.find((item) => item.role === "Руководитель" && item.status === "active");
      state.leads.filter((lead) => lead.ownerId === user.id).forEach((lead) => {
        lead.ownerId = fallback?.id ?? "";
        addActivity(state, lead.id, "system", "Ответственный удален", fallback ? `Аккаунт ${user.fullName} удален, сделка передана ${fallback.fullName}.` : `Аккаунт ${user.fullName} удален.`);
      });
      state.tasks = state.tasks.filter((task) => task.ownerId !== user.id);
      state.callRecords = state.callRecords.filter((call) => call.ownerId !== user.id);
      state.users = state.users.filter((item) => item.id !== user.id);
      disableCredential(user.email);
    }
  }

  if (action.type === "create_lead") {
    const lead: Lead = {
      ...action.payload,
      id: id("lead"),
      stage: 0,
      status: "sales",
      score: 0,
      temperature: "cold",
      createdAt: today()
    };
    lead.score = scoreLead(lead);
    lead.temperature = temperature(lead.score);
    state.leads.unshift(lead);
    addActivity(state, lead.id, "system", "Лид создан", `${lead.sourceChannel}: ${lead.sourceDetail}`);
    addTask(state, lead.id, lead.ownerId, "Найти контакт и сделать первый звонок", 0, "medium");
  }

  if (action.type === "move_stage") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (lead) {
      lead.stage = action.payload.stage;
      lead.status = lead.stage === 12 ? "lost" : lead.stage >= 9 ? "client" : lead.stage >= 6 ? "warmup" : "sales";
      lead.score = scoreLead(lead);
      lead.temperature = temperature(lead.score);
      lead.lastContactAt = today();
      addActivity(state, lead.id, "stage", "Этап изменен", STAGES[lead.stage]);
      if (lead.stage === 3) {
        scheduleNoAnswerFollowUps(state, lead, lead.ownerId);
      }
    }
  }

  if (action.type === "assign_lead") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    const owner = state.users.find((item) => item.id === action.payload.ownerId);
    if (lead && owner) {
      lead.ownerId = owner.id;
      addActivity(state, lead.id, "system", "Ответственный назначен", owner.fullName);
    }
  }

  if (action.type === "record_call") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    const owner = state.users.find((item) => item.id === action.payload.ownerId);
    if (lead && owner) {
      owner.calls += 1;
      lead.stage = Math.max(lead.stage, 4);
      lead.lastContactAt = today();
      lead.score = Math.min(100, scoreLead(lead) + 10);
      lead.temperature = temperature(lead.score);
      lead.nextStep = "Отправить SEO + GEO аудит и релевантный кейс";
      const call = {
        id: id("call"),
        leadId: lead.id,
        ownerId: owner.id,
        recordingUrl: "/recordings/demo-call.mp3",
        transcript: `Клиент ${lead.companyName} подтвердил боль: ${lead.pain}. Обсудили каналы: ${lead.currentPromotionChannels}. Бюджет: ${lead.budget}.`,
        summary: `AI заполнил карточку: боль "${lead.pain}", бюджет ${lead.budget}, следующий шаг: ${lead.nextStep}.`,
        objections: ["Нужно доказать окупаемость", "Нужен пример из похожей ниши"],
        nextSteps: ["Отправить аудит", "Назначить follow-up", "Запустить прогрев"],
        interest: Math.min(100, lead.score + 4),
        dealProbability: Math.min(95, lead.score),
        managerMistakes: ["Нужно закрепить точную дату следующего касания"],
        createdAt: today()
      };
      state.callRecords.unshift(call);
      addActivity(state, lead.id, "call", "Звонок записан", call.summary);
      addTask(state, lead.id, lead.ownerId, "Отправить аудит после звонка", 0, "high");
    }
  }

  if (action.type === "mark_no_answer") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    const owner = state.users.find((item) => item.id === action.payload.ownerId) ?? state.users.find((item) => item.id === lead?.ownerId);
    if (lead && owner) {
      lead.ownerId = owner.id;
      lead.stage = 3;
      lead.status = "sales";
      lead.lastContactAt = today();
      lead.nextStep = "Перезвонить по плану 1/3/7 дней";
      addActivity(state, lead.id, "call", "Не дозвонились", "CRM запустила автоматические задачи и уведомления на 1, 3 и 7 дней.");
      scheduleNoAnswerFollowUps(state, lead, owner.id);
    }
  }

  if (action.type === "send_message") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (lead) {
      lead.lastContactAt = today();
      addActivity(state, lead.id, "message", `Сообщение: ${action.payload.channel}`, action.payload.text);
    }
  }

  if (action.type === "start_warmup") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    const sequence = state.warmupSequences.find((item) => item.id === action.payload.sequenceId);
    if (lead && sequence) {
      lead.stage = Math.max(lead.stage, 6);
      lead.status = "warmup";
      addActivity(state, lead.id, "warmup", "Прогрев запущен", sequence.name);
      sequence.steps.forEach((step) => addTask(state, lead.id, lead.ownerId, `${step.title} · день ${step.day}`, step.day, "medium"));
    }
  }

  if (action.type === "create_warmup_step") {
    const sequence = state.warmupSequences.find((item) => item.id === action.payload.sequenceId);
    if (sequence) {
      sequence.steps.push({ id: id("warm"), day: action.payload.day, title: action.payload.title, message: action.payload.message, contentType: "Custom" });
    }
  }

  if (action.type === "mark_paid") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    const tariff = state.tariffs.find((item) => item.id === action.payload.tariffId);
    if (lead && tariff) {
      lead.stage = 9;
      lead.status = "client";
      lead.tariffId = tariff.id;
      state.payments.unshift({ id: id("pay"), leadId: lead.id, amount: tariff.price, paidAt: dateOnly(), provider: "RoboKassa", status: "paid" });
      state.subscriptions.unshift({ id: id("sub"), leadId: lead.id, tariffId: tariff.id, startedAt: dateOnly(), endsAt: dateOnly(90), nextPaymentAt: dateOnly(30), contractMonths: 3, status: "active" });
      addActivity(state, lead.id, "payment", "Оплата получена", `${tariff.name}: ${tariff.price} ₽`);
    }
  }

  if (action.type === "mark_refused") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (lead) {
      lead.stage = 12;
      lead.status = "lost";
      lead.refusalReason = action.payload.reason;
      lead.temperature = "cold";
      addActivity(state, lead.id, "stage", "Отказ зафиксирован", action.payload.reason);
    }
  }

  if (action.type === "renew_subscription") {
    const subscription = state.subscriptions.find((item) => item.id === action.payload.subscriptionId);
    const lead = subscription ? state.leads.find((item) => item.id === subscription.leadId) : undefined;
    if (subscription && lead) {
      const tariff = state.tariffs.find((item) => item.id === subscription.tariffId);
      subscription.nextPaymentAt = dateOnly(30);
      subscription.endsAt = dateOnly(90);
      lead.stage = 10;
      addActivity(state, lead.id, "payment", "Продление запущено", "Поставлены уведомления за 30/14/7/3 дня.");
      if (tariff) addTask(state, lead.id, lead.ownerId, `Продлить подписку ${tariff.name}`, 7, "high");
    }
  }

  if (action.type === "run_automation") {
    state.leads.forEach((lead) => {
      if (action.payload.key === "no_answer_3") addActivity(state, lead.id, "message", "Автоматизация 3 дня", "Отправлено сообщение в последний активный канал.");
      if (action.payload.key === "no_answer_7") addTask(state, lead.id, lead.ownerId, "Нет ответа 7 дней: связаться вручную", 0, "high", "no_answer_7");
      if (action.payload.key === "no_answer_14") addActivity(state, lead.id, "warmup", "Автоматизация 14 дней", "Запущена реактивационная цепочка прогрева.");
      if (action.payload.key === "missed_call" && lead.stage === 3) {
        scheduleNoAnswerFollowUps(state, lead, lead.ownerId);
      }
    });
  }

  if (action.type === "toggle_integration") {
    const integration = state.integrations.find((item) => item.id === action.payload.integrationId);
    if (integration) {
      integration.status = integration.status === "connected" ? "needs_setup" : "connected";
    }
  }

  if (!suppressLocalPersistence) persistState(state);
  return cloneState();
}

export async function applyCrmActionAsync(action: CrmAction): Promise<CrmState> {
  globalForCrm.optiCrmState = await getCrmStateAsync();
  suppressLocalPersistence = true;
  try {
    const nextState = applyCrmAction(action);
    await persistCrmStateAsync(globalForCrm.optiCrmState);
    return nextState;
  } finally {
    suppressLocalPersistence = false;
  }
}

export async function persistCredentialsAsync() {
  if (!supabasePersistenceEnabled()) return;
  await writeSupabaseValue(credentialsKey, getCredentialsSnapshot());
}

export function dashboardMetrics(state: CrmState) {
  const activeSubscriptions = state.subscriptions.filter((item) => item.status === "active");
  const mrr = activeSubscriptions.reduce((sum, subscription) => {
    const tariff = state.tariffs.find((item) => item.id === subscription.tariffId);
    return sum + (tariff?.price ?? 0);
  }, 0);
  const wonLeads = state.leads.filter((lead) => lead.status === "client").length;
  const lostLeads = state.leads.filter((lead) => lead.status === "lost").length;
  const churn = wonLeads + lostLeads ? Math.round((lostLeads / (wonLeads + lostLeads)) * 1000) / 10 : 0;
  const ltv = activeSubscriptions.length ? Math.round((mrr / activeSubscriptions.length) * 8.5) : 0;
  return {
    leads: state.leads.length,
    calls: state.callRecords.length,
    deals: wonLeads,
    payments: state.payments.filter((item) => item.status === "paid").length,
    mrr,
    churn,
    ltv,
    conversion: state.leads.length ? Math.round((wonLeads / state.leads.length) * 100) : 0
  };
}
