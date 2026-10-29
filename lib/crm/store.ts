import { createSeedState } from "./seed";
import { disableCredential, getCredentialsSnapshot, hydrateCredentialsSnapshot } from "@/lib/auth/credentials";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { ensureNormalizedCrmState, writeNormalizedCrmState } from "./normalized-store";
import { migrateLegacyIntegrationSecrets } from "@/lib/integrations/secrets";
import { normalizeRole, STAGES, type CrmAction, type CrmState, type CrmUser, type DashboardMetrics, type Lead, type LeadTemperature, type LeadUpdate, type ManualCallResult, type SalesPeriodMetrics } from "./types";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hydrateUserSettings, saveUserSettings } from "@/lib/os/user-settings";
import { hydrateLeadOperations, saveActivationCheck, saveLeadOperations } from "./operations-store";
import { addCalendarDays, daysBetweenCalendarDates, formatMoscowDate, moscowDateKey, moscowMonthStartDateKey, moscowWeekStartDateKey } from "@/lib/time/moscow";

const globalForCrm = globalThis as unknown as { optiCrmState?: CrmState };
const dataDir = process.env.CRM_DATA_DIR || path.join(process.cwd(), "data");
const stateFile = path.join(dataDir, "crm-state.json");
const tempStateFile = path.join(dataDir, "crm-state.tmp.json");
const retiredSeedUserIds = new Set(["u-anna", "u-sofia", "u-ilya", "u-rop"]);
const retiredSeedUserEmails = ["anna@optiai.ru", "sofia@optiai.ru", "ilya@optiai.ru", "rop@optiai.ru"];
const activationCheckCodes = ["questionnaire_sent", "questionnaire_received", "integration_completed", "keywords_approved", "subscription_activated", "days_added"] as const;
const credentialsKey = "credentials";
let suppressLocalPersistence = false;

export function supabasePersistenceEnabled() {
  if (process.env.CRM_FORCE_LOCAL === "true") return false;
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
  state.users.forEach((user) => {
    const role = normalizeRole(user.role);
    if (user.role !== role) {
      user.role = role;
      changed = true;
    }
  });
  if (!state.integrations.some((integration) => integration.id === "optiai")) {
    state.integrations.push({ id: "optiai", name: "Платформа OptiAI", description: "Регистрации, проекты, оплаты и подписки через API/webhook", status: "needs_setup" });
    changed = true;
  }
  if (state.leads.some((lead) => lead.stage > 6)) {
    state.leads.forEach((lead) => {
      lead.stage = lead.stage === 0 ? 0
        : lead.stage <= 6 ? 1
          : lead.stage === 7 ? 2
            : lead.stage === 8 ? 3
              : lead.stage <= 11 ? 4 : 6;
      lead.status = leadStatusForStage(lead.stage);
    });
    changed = true;
  }
  if (!state.integrations.some((integration) => integration.id === "ai")) {
    state.integrations.push({ id: "ai", name: "AI-ассистент", description: "Анализ звонков, автоматические ответы и персонализация прогревов", status: "needs_setup" });
    changed = true;
  } else {
    const ai = state.integrations.find((integration) => integration.id === "ai")!;
    if (ai.name !== "AI-ассистент" || ai.description !== "Анализ звонков, автоматические ответы и персонализация прогревов") {
      ai.name = "AI-ассистент";
      ai.description = "Анализ звонков, автоматические ответы и персонализация прогревов";
      changed = true;
    }
  }
  if (!Array.isArray(state.warmupSequences)) {
    state.warmupSequences = [];
    changed = true;
  }
  state.warmupSequences.forEach((sequence) => {
    const before = sequence.steps.map((step) => step.id).join("|");
    sequence.steps.sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, "ru"));
    if (before !== sequence.steps.map((step) => step.id).join("|")) changed = true;
  });
  const retiredUsers = state.users.filter((user) => retiredSeedUserIds.has(user.id));
  if (retiredUsers.length === 0) return { state, changed };

  const retiredIds = new Set(retiredUsers.map((user) => user.id));
  const fallback = state.users.find((user) => user.role === "Менеджер по продажам" && user.status === "active" && !retiredIds.has(user.id))
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

function id() {
  return randomUUID();
}

function today() {
  return new Date().toISOString();
}

function dateOnly(daysFromNow = 0) {
  return addCalendarDays(moscowDateKey(), daysFromNow);
}

function shiftDate(value: string, days: number) {
  return addCalendarDays(value, days);
}

export function getCrmState(): CrmState {
  const migrated = migrateState(readPersistedState() ?? createSeedState());
  globalForCrm.optiCrmState = migrated.state;
  if (migrated.changed || !existsSync(stateFile)) persistState(globalForCrm.optiCrmState);
  return globalForCrm.optiCrmState;
}

export async function getCrmStateAsync(): Promise<CrmState> {
  if (!supabasePersistenceEnabled()) return getCrmState();

  const storedCredentials = await readSupabaseValue<ReturnType<typeof getCredentialsSnapshot>>(credentialsKey);

  if (storedCredentials) hydrateCredentialsSnapshot(storedCredentials);

  const storedState = await ensureNormalizedCrmState(createSeedState());
  if (!isCrmState(storedState)) throw new Error("Supabase вернул некорректное состояние CRM.");
  const migrated = migrateState(storedState);
  await hydrateUserSettings(migrated.state);
  await hydrateLeadOperations(migrated.state);
  if (await migrateLegacyIntegrationSecrets(migrated.state.integrations)) migrated.changed = true;
  globalForCrm.optiCrmState = migrated.state;
  if (migrated.changed) {
    await persistCrmStateAsync(globalForCrm.optiCrmState);
  }
  return globalForCrm.optiCrmState;
}

async function persistCrmStateAsync(state: CrmState) {
  if (!supabasePersistenceEnabled()) {
    persistState(state);
    return;
  }
  await Promise.all([
    writeNormalizedCrmState(state),
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
  if (!user || user.role === "Руководитель") return state;
  if (user.role === "Менеджер по продажам" || user.role === "Технический специалист") {
    return {
      ...state,
      payments: [],
      tariffs: state.tariffs.map((tariff) => ({ ...tariff, price: 0 }))
    };
  }
  const allowedLeadIds = new Set(state.leads.filter((lead) => lead.ownerId === user.id && lead.status === "client").map((lead) => lead.id));
  return filterStateByLeads(state, allowedLeadIds, user.id);
}

function filterStateByLeads(state: CrmState, leadIds: Set<string>, userId: string): CrmState {
  return {
    ...state,
    leads: state.leads.filter((lead) => leadIds.has(lead.id)),
    subscriptions: state.subscriptions.filter((subscription) => leadIds.has(subscription.leadId)),
    payments: state.payments.filter((payment) => leadIds.has(payment.leadId)),
    tasks: state.tasks.filter((task) => leadIds.has(task.leadId)),
    activities: state.activities.filter((activity) => leadIds.has(activity.leadId)),
    callRecords: state.callRecords.filter((call) => leadIds.has(call.leadId)),
    users: state.users.filter((user) => user.id === userId)
  };
}

function addActivity(state: CrmState, leadId: string, type: CrmState["activities"][number]["type"], title: string, detail: string) {
  state.activities.unshift({ id: id(), leadId, type, title, detail, createdAt: today() });
}

function addTask(state: CrmState, leadId: string, ownerId: string, title: string, daysFromNow: number, priority: "high" | "medium" | "low", automationKey?: string) {
  state.tasks.unshift({ id: id(), leadId, ownerId, title, dueAt: dateOnly(daysFromNow), priority, status: "open", automationKey, taskType: title.toLocaleLowerCase("ru").includes("звон") ? "call" : "other", description: title, manualOverride: false, source: automationKey ? automationKey.startsWith("warmup:") ? "warmup" : "automation" : "manual", history: [{ at: today(), action: "created" }] });
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

function recordManualCallResult(
  state: CrmState,
  payload: { leadId: string; ownerId: string; result: ManualCallResult; comment?: string }
) {
  const lead = state.leads.find((item) => item.id === payload.leadId);
  const caller = state.users.find((item) => item.id === payload.ownerId && item.status === "active");
  if (!lead || !caller) throw new Error("Лид или сотрудник не найден.");

  const comment = payload.comment?.trim() ?? "";
  if (payload.result === "comment") {
    if (!comment) throw new Error("Добавьте комментарий к звонку.");
    addActivity(state, lead.id, "call", "Комментарий к звонку", comment);
    return;
  }

  lead.lastContactAt = today();

  if (payload.result === "no_answer" || payload.result === "busy") {
    lead.stage = 1;
    lead.status = "warmup";
    lead.nextStep = "Перезвонить по плану 1/3/7 дней";
    addActivity(
      state,
      lead.id,
      "call",
      payload.result === "busy" ? "Занято" : "Не дозвонились",
      comment || "CRM поставила ответственному задачи на повторный звонок через 1, 3 и 7 дней."
    );
    scheduleNoAnswerFollowUps(state, lead, lead.ownerId);
    return;
  }

  if (payload.result === "invalid_number" || payload.result === "other") {
    lead.stage = 1;
    lead.status = "warmup";
    lead.nextStep = payload.result === "invalid_number" ? "Проверить контактный номер" : "Назначить следующее действие";
    addActivity(state, lead.id, "call", payload.result === "invalid_number" ? "Неверный номер" : "Другой результат звонка", comment || lead.nextStep);
    addTask(state, lead.id, lead.ownerId, lead.nextStep, 0, "high");
    return;
  }

  caller.calls += 1;
  lead.stage = Math.max(lead.stage, 1);
  lead.status = leadStatusForStage(lead.stage);
  lead.score = Math.min(100, scoreLead(lead) + 10);
  lead.temperature = temperature(lead.score);

  if (payload.result === "meeting") {
    caller.meetings += 1;
    lead.nextStep = "Подготовиться к назначенной встрече";
    addActivity(state, lead.id, "call", "Назначена встреча", comment || "Менеджер договорился о встрече с клиентом.");
    addTask(state, lead.id, lead.ownerId, "Подготовиться к встрече с клиентом", 1, "high");
    return;
  }

  lead.nextStep = "Отправить SEO + GEO аудит и релевантный кейс";
  addActivity(state, lead.id, "call", "Дозвонились", comment || "Разговор состоялся, результат зафиксирован менеджером вручную.");
  addTask(state, lead.id, lead.ownerId, "Отправить аудит после звонка", 0, "high");
}

function dateLabelForTask(daysFromNow: number) {
  return formatMoscowDate(dateOnly(daysFromNow), { day: "2-digit", month: "long", year: "numeric" });
}

function dateLabelForTaskDate(value: string) {
  return formatMoscowDate(value, { day: "2-digit", month: "long", year: "numeric" });
}

function leadStatusForStage(stage: number): Lead["status"] {
  if (stage === 6) return "lost";
  if (stage === 4) return "client";
  if (stage === 1) return "warmup";
  return "sales";
}

const editableLeadFields: (keyof LeadUpdate)[] = [
  "companyName", "site", "industry", "companySize", "region", "contactName", "contactRole", "phone", "email",
  "telegram", "whatsapp", "max", "hasSeo", "hasContext", "hasMarketer", "hasAgency", "brandedQueries",
  "llmVisibility", "geoPotential", "stage", "sourceChannel", "sourceDetail", "ownerId", "pain",
  "currentPromotionChannels", "budget", "nextStep", "refusalReason", "tariffId"
];

export function applyCrmAction(action: CrmAction): CrmState {
  const state = suppressLocalPersistence && globalForCrm.optiCrmState ? globalForCrm.optiCrmState : getCrmState();

  if (action.type === "complete_task" || action.type === "cancel_task" || action.type === "reschedule_task") {
    const task = state.tasks.find((item) => item.id === action.payload.taskId);
    if (!task) throw new Error("Задача не найдена.");
    const lead = state.leads.find((item) => item.id === task.leadId);
    if (action.type === "complete_task") {
      task.status = "done";
      task.history = [...(task.history ?? []), { at: today(), action: "completed" }];
      if (lead) addActivity(state, lead.id, "task", "Задача выполнена", task.title);
    }
    if (action.type === "cancel_task") {
      task.status = "cancelled";
      task.history = [...(task.history ?? []), { at: today(), action: "cancelled" }];
      if (lead) addActivity(state, lead.id, "task", "Задача отменена", task.title);
    }
    if (action.type === "reschedule_task") {
      const dueAt = action.payload.dueAt.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt) || Number.isNaN(Date.parse(`${dueAt}T00:00:00Z`))) {
        throw new Error("Укажите корректную дату задачи.");
      }
      if (dueAt < dateOnly()) throw new Error("Задачу нельзя перенести в прошлое.");
      task.dueAt = dueAt;
      task.dueTime = action.payload.dueTime?.trim() || undefined;
      task.status = "open";
      task.manualOverride = true;
      task.source = "manual";
      const deadline = `${dueAt}${task.dueTime ? ` ${task.dueTime}` : ""}`;
      task.history = [...(task.history ?? []), { at: today(), action: "rescheduled", detail: deadline }];
      if (lead) addActivity(state, lead.id, "task", "Задача перенесена", `${task.title}: ${dateLabelForTaskDate(dueAt)}${task.dueTime ? `, ${task.dueTime}` : ""}.`);
    }
  }

  if (action.type === "update_user_access") {
    const user = state.users.find((item) => item.id === action.payload.userId);
    if (!user) throw new Error("Сотрудник не найден.");
    user.appPermissions = [...new Set(action.payload.appPermissions)];
    user.autoAssignEnabled = action.payload.autoAssignEnabled;
  }

  if (action.type === "update_lead_operations") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (!lead) throw new Error("Лид не найден.");
    Object.entries(action.payload.changes).forEach(([key, value]) => {
      (lead as unknown as Record<string, unknown>)[key] = value ?? undefined;
    });
    addActivity(state, lead.id, "system", "Операционная карточка обновлена", "Обновлены данные проекта и аккаунта OptiAI.");
  }

  if (action.type === "set_activation_check") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (!lead) throw new Error("Лид не найден.");
    const checks = lead.activationChecks ?? [];
    const existing = checks.find((item) => item.code === action.payload.code);
    if (existing) {
      existing.completedAt = action.payload.completed ? today() : undefined;
      existing.completedBy = action.payload.completed ? action.payload.actorId : undefined;
      existing.notApplicable = Boolean(action.payload.notApplicable);
    } else {
      checks.push({ code: action.payload.code, completedAt: action.payload.completed ? today() : undefined, completedBy: action.payload.completed ? action.payload.actorId : undefined, notApplicable: Boolean(action.payload.notApplicable) });
    }
    lead.activationChecks = checks;
    addActivity(state, lead.id, "system", action.payload.completed ? "Пункт подключения выполнен" : "Пункт подключения возвращён в работу", action.payload.code);
  }

  if (action.type === "set_scripts_sent") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (!lead) throw new Error("Лид не найден.");
    lead.scriptsSent = action.payload.completed;
    lead.scriptsSentAt = action.payload.completed ? today() : undefined;
    addActivity(state, lead.id, "system", action.payload.completed ? "Скрипты отправлены" : "Отправка скриптов отменена", "Статус зафиксирован в карточке клиента.");
  }

  if (action.type === "create_user") {
    if (!supabasePersistenceEnabled()) throw new Error("Создание аккаунтов сотрудников требует подключенного Supabase Auth.");
    const normalizedEmail = action.payload.email.trim().toLowerCase();
    if (state.users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      throw new Error("Сотрудник с таким email уже существует.");
    }
    const newUser = {
      id: id(),
      fullName: action.payload.fullName.trim(),
      email: normalizedEmail,
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
  }

  if (action.type === "update_owner_profile") {
    const user = state.users.find((item) => item.id === action.payload.userId && item.role === "Руководитель");
    if (!user) throw new Error("Аккаунт руководителя не найден.");

    const normalizedEmail = action.payload.email.trim().toLowerCase();
    if (state.users.some((item) => item.id !== user.id && item.email.toLowerCase() === normalizedEmail)) {
      throw new Error("Аккаунт с таким email уже существует.");
    }

    user.fullName = action.payload.fullName.trim();
    user.email = normalizedEmail;
    user.position = action.payload.position.trim();
  }

  if (action.type === "disable_user") {
    const user = state.users.find((item) => item.id === action.payload.userId);
    const fallback = state.users.find((item) => item.role === user?.role && item.status === "active" && item.id !== user?.id)
      ?? state.users.find((item) => item.role === "Менеджер по продажам" && item.status === "active" && item.id !== user?.id)
      ?? state.users.find((item) => item.role === "Руководитель" && item.status === "active" && item.id !== user?.id);
    if (user && user.role !== "Руководитель") {
      user.status = "disabled";
      if (!supabasePersistenceEnabled()) disableCredential(user.email);
      if (fallback) {
        state.leads.filter((lead) => lead.ownerId === user.id).forEach((lead) => {
          lead.ownerId = fallback.id;
          addActivity(state, lead.id, "system", "Ответственный изменен", `Аккаунт ${user.fullName} отключен, сделка передана ${fallback.fullName}.`);
        });
        state.tasks.filter((task) => task.ownerId === user.id && task.status === "open").forEach((task) => { task.ownerId = fallback.id; });
      }
    }
  }

  if (action.type === "delete_user") {
    const user = state.users.find((item) => item.id === action.payload.userId);
    if (user && user.role !== "Руководитель") {
      const fallback = state.users.find((item) => item.role === "Менеджер по продажам" && item.status === "active" && item.id !== user.id)
        ?? state.users.find((item) => item.role === "Руководитель" && item.status === "active");
      state.leads.filter((lead) => lead.ownerId === user.id).forEach((lead) => {
        lead.ownerId = fallback?.id ?? "";
        addActivity(state, lead.id, "system", "Ответственный удален", fallback ? `Аккаунт ${user.fullName} удален, сделка передана ${fallback.fullName}.` : `Аккаунт ${user.fullName} удален.`);
      });
      if (fallback) {
        state.tasks.filter((task) => task.ownerId === user.id && task.status === "open").forEach((task) => { task.ownerId = fallback.id; });
      } else {
        state.tasks = state.tasks.filter((task) => task.ownerId !== user.id);
      }
      state.callRecords.filter((call) => call.ownerId === user.id).forEach((call) => { call.ownerId = fallback?.id ?? ""; });
      state.users = state.users.filter((item) => item.id !== user.id);
      if (!supabasePersistenceEnabled()) disableCredential(user.email);
    }
  }

  if (action.type === "create_lead") {
    const comparable = (value?: string) => (value ?? "").trim().toLocaleLowerCase("ru");
    const phoneDigits = (value?: string) => (value ?? "").replace(/\D/g, "");
    const duplicate = state.leads.find((lead) =>
      (phoneDigits(action.payload.phone).length >= 7 && phoneDigits(lead.phone) === phoneDigits(action.payload.phone))
      || (comparable(action.payload.email) && comparable(action.payload.email) !== "уточнить" && comparable(lead.email) === comparable(action.payload.email))
      || (comparable(action.payload.telegram) && comparable(action.payload.telegram) !== "уточнить" && comparable(lead.telegram) === comparable(action.payload.telegram))
    );
    if (duplicate) throw new Error(`Лид уже существует: ${duplicate.companyName}. Откройте существующую карточку.`);
    const autoOwners = state.users
      .filter((user) => user.status === "active" && user.role === "Менеджер по продажам" && user.autoAssignEnabled)
      .sort((left, right) => state.leads.filter((lead) => lead.ownerId === left.id).length - state.leads.filter((lead) => lead.ownerId === right.id).length || left.createdAt.localeCompare(right.createdAt));
    const fallbackOwner = state.users.find((user) => user.status === "active" && user.id === action.payload.ownerId)
      ?? autoOwners[0]
      ?? state.users.find((user) => user.status === "active" && user.role === "Менеджер по продажам")
      ?? state.users.find((user) => user.status === "active" && user.role === "Руководитель");
    if (!fallbackOwner) throw new Error("Нет активного сотрудника, которому можно назначить лида.");
    const lead: Lead = {
      ...action.payload,
      ownerId: fallbackOwner.id,
      id: id(),
      stage: 0,
      status: "sales",
      score: 0,
      temperature: "cold",
      createdAt: today()
    };
    lead.originalOwnerId = fallbackOwner.id;
    lead.score = scoreLead(lead);
    lead.temperature = temperature(lead.score);
    state.leads.unshift(lead);
    addActivity(state, lead.id, "system", "Лид создан", `${lead.sourceChannel}: ${lead.sourceDetail}`);
    addTask(state, lead.id, lead.ownerId, "Найти контакт и сделать первый звонок", 0, "medium");
  }

  if (action.type === "update_lead") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (!lead) throw new Error("Лид не найден.");

    const requestedChanges = action.payload.changes;
    const changes: LeadUpdate = {};
    editableLeadFields.forEach((field) => {
      const value = requestedChanges[field];
      if (value !== undefined) (changes as Record<string, unknown>)[field] = value;
    });
    const nextStage = changes.stage === undefined ? lead.stage : Math.trunc(changes.stage);
    if (nextStage < 0 || nextStage >= STAGES.length) throw new Error("Некорректный этап воронки.");
    if (changes.ownerId !== undefined) {
      const owner = state.users.find((user) => user.id === changes.ownerId && user.status === "active");
      if (!owner) throw new Error("Выбранный ответственный недоступен.");
    }

    const nextCompanyName = (changes.companyName ?? lead.companyName).trim();
    const nextContactName = (changes.contactName ?? lead.contactName).trim();
    const nextPhone = (changes.phone ?? lead.phone).trim();
    const nextRefusalReason = changes.refusalReason ?? lead.refusalReason;
    if (!nextCompanyName || !nextContactName || !nextPhone) {
      throw new Error("Укажите компанию, контактное лицо и телефон.");
    }
    if (nextStage === 6 && !nextRefusalReason?.trim()) throw new Error("Для этапа «Отказ» укажите причину отказа.");

    Object.assign(lead, changes, {
      stage: nextStage,
      companyName: nextCompanyName,
      contactName: nextContactName,
      phone: nextPhone
    });
    lead.status = leadStatusForStage(lead.stage);
    lead.score = scoreLead(lead);
    lead.temperature = temperature(lead.score);
    addActivity(state, lead.id, "system", "Карточка лида обновлена", `Актуальный этап: ${STAGES[lead.stage]}.`);
  }

  if (action.type === "delete_lead") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (!lead) throw new Error("Лид уже удален или не найден.");
    state.leads = state.leads.filter((item) => item.id !== lead.id);
    state.tasks = state.tasks.filter((item) => item.leadId !== lead.id);
    state.activities = state.activities.filter((item) => item.leadId !== lead.id);
    state.callRecords = state.callRecords.filter((item) => item.leadId !== lead.id);
    state.subscriptions = state.subscriptions.filter((item) => item.leadId !== lead.id);
    state.payments = state.payments.filter((item) => item.leadId !== lead.id);
  }

  if (action.type === "move_stage") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (lead) {
      const nextStage = Math.trunc(action.payload.stage);
      if (nextStage < 0 || nextStage >= STAGES.length) throw new Error("Некорректный этап воронки.");
      if (nextStage === 6 && !lead.refusalReason?.trim()) throw new Error("Переведите лида в отказ через действие с указанием причины.");
      if (nextStage === 4) {
        const paid = state.payments.some((payment) => payment.leadId === lead.id && payment.status === "paid");
        const completedChecks = new Set((lead.activationChecks ?? []).filter((check) => Boolean(check.completedAt) || check.notApplicable).map((check) => check.code));
        if (!paid) throw new Error("Подключение нельзя завершить без подтверждённой оплаты.");
        if (!activationCheckCodes.every((code) => completedChecks.has(code))) throw new Error("Завершите все пункты подключения или отметьте неприменимые.");
      }
      lead.stage = nextStage;
      lead.status = leadStatusForStage(lead.stage);
      lead.score = scoreLead(lead);
      lead.temperature = temperature(lead.score);
      lead.lastContactAt = today();
      addActivity(state, lead.id, "stage", "Этап изменен", STAGES[lead.stage]);
      if (lead.stage === 5) {
        const originalOwner = state.users.find((user) => user.id === (lead.originalOwnerId ?? lead.ownerId) && user.status === "active");
        const renewalOwner = originalOwner ?? state.users.find((user) => user.role === "Руководитель" && user.status === "active");
        if (renewalOwner) {
          lead.ownerId = renewalOwner.id;
          addTask(state, lead.id, renewalOwner.id, "Срочно связаться: клиент не продлил подписку", 0, "high", `renewal:${lead.id}`);
        }
      }
    }
  }

  if (action.type === "connect_lead") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (!lead) throw new Error("Лид не найден.");
    lead.stage = 4;
    lead.status = "client";
    lead.lastContactAt = today();
    addActivity(state, lead.id, "stage", "Подключение подтверждено платформой", STAGES[4]);
  }

  if (action.type === "assign_lead") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    const owner = state.users.find((item) => item.id === action.payload.ownerId && item.status === "active");
    if (lead && owner) {
      lead.ownerId = owner.id;
      state.tasks.filter((task) => task.leadId === lead.id && task.status === "open").forEach((task) => { task.ownerId = owner.id; });
      addActivity(state, lead.id, "system", "Ответственный назначен", owner.fullName);
    }
  }

  if (action.type === "record_call") {
    recordManualCallResult(state, { ...action.payload, result: "answered" });
  }

  if (action.type === "mark_no_answer") {
    recordManualCallResult(state, { ...action.payload, result: "no_answer" });
  }

  if (action.type === "record_call_result") {
    recordManualCallResult(state, action.payload);
  }

  if (action.type === "import_sip_call") {
    if (!state.callRecords.some((call) => call.externalId === action.payload.externalId)) {
      recordManualCallResult(state, { leadId: action.payload.leadId, ownerId: action.payload.ownerId, result: action.payload.result, comment: `SIP · ${action.payload.durationSeconds} сек.` });
      state.callRecords.unshift({ id: id(), leadId: action.payload.leadId, ownerId: action.payload.ownerId, recordingUrl: action.payload.recordingUrl ?? "", transcript: "", summary: "", objections: [], nextSteps: [], interest: 0, dealProbability: 0, managerMistakes: [], createdAt: today(), callResult: action.payload.result, durationSeconds: action.payload.durationSeconds, externalId: action.payload.externalId });
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
    if (!lead) throw new Error("Лид не найден.");
    if (!sequence) throw new Error("Цепочка прогрева не найдена.");
    if (!sequence.active) throw new Error("Сначала включите выбранную цепочку прогрева.");
    if (lead && sequence) {
      lead.stage = 1;
      lead.status = "warmup";
      addActivity(state, lead.id, "warmup", "Прогрев запущен", sequence.name);
      state.tasks = state.tasks.filter((task) => !(task.leadId === lead.id && task.automationKey?.startsWith("warmup:") && task.status === "open"));
      [...sequence.steps]
        .sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, "ru"))
        .forEach((step) => addTask(state, lead.id, lead.ownerId, `${step.title} · день ${step.day}`, step.day, "medium", `warmup:${sequence.id}:${step.id}`));
    }
  }

  if (action.type === "create_warmup_sequence") {
    if (state.warmupSequences.some((item) => item.name.trim().toLowerCase() === action.payload.name.trim().toLowerCase())) {
      throw new Error("Цепочка с таким названием уже существует.");
    }
    state.warmupSequences.push({
      id: id(),
      name: action.payload.name.trim(),
      description: action.payload.description.trim(),
      active: action.payload.active,
      steps: []
    });
  }

  if (action.type === "update_warmup_sequence") {
    const sequence = state.warmupSequences.find((item) => item.id === action.payload.sequenceId);
    if (!sequence) throw new Error("Цепочка прогрева не найдена.");
    if (state.warmupSequences.some((item) => item.id !== sequence.id && item.name.trim().toLowerCase() === action.payload.name.trim().toLowerCase())) {
      throw new Error("Цепочка с таким названием уже существует.");
    }
    sequence.name = action.payload.name.trim();
    sequence.description = action.payload.description.trim();
    sequence.active = action.payload.active;
  }

  if (action.type === "delete_warmup_sequence") {
    const sequence = state.warmupSequences.find((item) => item.id === action.payload.sequenceId);
    if (!sequence) throw new Error("Цепочка прогрева не найдена.");
    state.warmupSequences = state.warmupSequences.filter((item) => item.id !== sequence.id);
    state.tasks = state.tasks.filter((task) => !task.automationKey?.startsWith(`warmup:${sequence.id}:`) || task.status !== "open");
  }

  if (action.type === "create_warmup_step") {
    const sequence = state.warmupSequences.find((item) => item.id === action.payload.sequenceId);
    if (!sequence) throw new Error("Цепочка прогрева не найдена.");
    sequence.steps.push({
      id: id(),
      day: Math.max(0, Math.floor(action.payload.day)),
      title: action.payload.title,
      message: action.payload.message,
      contentType: action.payload.contentType ?? "Custom",
      attachmentUrl: action.payload.attachmentUrl,
      attachmentType: action.payload.attachmentType,
      attachmentName: action.payload.attachmentName
    });
    sequence.steps.sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, "ru"));
  }

  if (action.type === "update_warmup_step") {
    const sequence = state.warmupSequences.find((item) => item.id === action.payload.sequenceId);
    const step = sequence?.steps.find((item) => item.id === action.payload.stepId);
    if (!sequence || !step) throw new Error("Шаг прогрева не найден.");
    if (sequence && step) {
      const dayDelta = Math.max(0, Math.floor(action.payload.day)) - step.day;
      step.day = Math.max(0, Math.floor(action.payload.day));
      step.title = action.payload.title.trim();
      step.message = action.payload.message.trim();
      step.contentType = action.payload.contentType;
      step.attachmentUrl = action.payload.attachmentUrl ?? undefined;
      step.attachmentType = action.payload.attachmentType ?? undefined;
      step.attachmentName = action.payload.attachmentName ?? undefined;
      state.tasks
        .filter((task) => task.automationKey === `warmup:${sequence.id}:${step.id}` && task.status === "open")
        .forEach((task) => {
          task.title = `${step.title} · день ${step.day}`;
          if (dayDelta) task.dueAt = shiftDate(task.dueAt, dayDelta);
        });
      sequence.steps.sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, "ru"));
    }
  }

  if (action.type === "delete_warmup_step") {
    const sequence = state.warmupSequences.find((item) => item.id === action.payload.sequenceId);
    if (!sequence || !sequence.steps.some((step) => step.id === action.payload.stepId)) throw new Error("Шаг прогрева не найден.");
    sequence.steps = sequence.steps.filter((step) => step.id !== action.payload.stepId);
    state.tasks = state.tasks.filter((task) => task.automationKey !== `warmup:${sequence.id}:${action.payload.stepId}` || task.status !== "open");
  }

  if (action.type === "mark_paid") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    const tariff = state.tariffs.find((item) => item.id === action.payload.tariffId);
    if (lead && tariff) {
      lead.stage = 3;
      lead.status = "sales";
      lead.tariffId = tariff.id;
      if (!state.payments.some((payment) => payment.leadId === lead.id && payment.status === "paid")) {
        state.payments.unshift({ id: id(), leadId: lead.id, amount: tariff.price, paidAt: dateOnly(), provider: "manual", status: "paid" });
      }
      const activeSubscription = state.subscriptions.find((item) => item.leadId === lead.id && item.status === "active");
      if (activeSubscription) {
        activeSubscription.tariffId = tariff.id;
        activeSubscription.nextPaymentAt = dateOnly(30);
        activeSubscription.endsAt = dateOnly(90);
      } else {
        state.subscriptions.unshift({ id: id(), leadId: lead.id, tariffId: tariff.id, startedAt: dateOnly(), endsAt: dateOnly(90), nextPaymentAt: dateOnly(30), contractMonths: 3, status: "active" });
      }
      addActivity(state, lead.id, "payment", "Оплата получена", `${tariff.name}: ${tariff.price} ₽`);
    }
  }

  if (action.type === "mark_refused") {
    const lead = state.leads.find((item) => item.id === action.payload.leadId);
    if (lead) {
      lead.stage = 6;
      lead.status = "lost";
      lead.refusalReason = action.payload.reason;
      lead.temperature = "cold";
      state.subscriptions.filter((subscription) => subscription.leadId === lead.id && subscription.status === "active")
        .forEach((subscription) => { subscription.status = "cancelled"; });
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
      lead.stage = 4;
      lead.status = "client";
      state.tasks
        .filter((task) => task.leadId === lead.id && task.status === "open" && (task.automationKey?.startsWith(`renewal:${lead.id}`) || /продл/i.test(task.title)))
        .forEach((task) => {
          task.status = "done";
          task.result = "Подписка успешно продлена";
          task.history = [...(task.history ?? []), { at: today(), action: "completed", detail: "subscription_renewed" }];
        });
      addActivity(state, lead.id, "payment", "Подписка продлена", tariff ? `${tariff.name}; напоминания 30/14/7/3 дня будут рассчитаны от нового срока.` : "Срок подписки обновлён платформой.");
    }
  }

  if (action.type === "run_automation") {
    state.leads.forEach((lead) => {
      if (action.payload.key === "no_answer_3") addActivity(state, lead.id, "message", "Автоматизация 3 дня", "Отправлено сообщение в последний активный канал.");
      if (action.payload.key === "no_answer_7") addTask(state, lead.id, lead.ownerId, "Нет ответа 7 дней: связаться вручную", 0, "high", "no_answer_7");
      if (action.payload.key === "no_answer_14") addActivity(state, lead.id, "warmup", "Автоматизация 14 дней", "Запущена реактивационная цепочка прогрева.");
      if (action.payload.key === "missed_call" && lead.stage === 1) {
        scheduleNoAnswerFollowUps(state, lead, lead.ownerId);
      }
    });
  }

  if (action.type === "toggle_integration") {
    const integration = state.integrations.find((item) => item.id === action.payload.integrationId);
    if (integration) {
      integration.status = integration.status === "connected" ? "needs_setup" : "connected";
      integration.updatedAt = today();
    }
  }

  if (action.type === "configure_integration") {
    const integration = state.integrations.find((item) => item.id === action.payload.integrationId);
    if (integration) {
      delete integration.config;
      integration.status = "connected";
      integration.updatedAt = today();
    }
  }

  if (!suppressLocalPersistence) persistState(state);
  return structuredClone(state);
}

export async function applyCrmActionAsync(action: CrmAction): Promise<CrmState> {
  globalForCrm.optiCrmState = await getCrmStateAsync();
  suppressLocalPersistence = true;
  try {
    const nextState = applyCrmAction(action);
    await persistCrmStateAsync(globalForCrm.optiCrmState);
    if (action.type === "update_user_access") {
      const user = globalForCrm.optiCrmState.users.find((item) => item.id === action.payload.userId);
      if (user) await saveUserSettings(user);
    }
    if (action.type === "update_lead_operations" || action.type === "set_scripts_sent") {
      const lead = globalForCrm.optiCrmState.leads.find((item) => item.id === action.payload.leadId);
      if (lead) await saveLeadOperations(lead, action.type === "set_scripts_sent" ? action.payload.actorId : undefined);
    }
    if (action.type === "create_lead") {
      const lead = globalForCrm.optiCrmState.leads.find((item) => item.phone === action.payload.phone && item.email === action.payload.email);
      if (lead) await saveLeadOperations(lead);
    }
    if (action.type === "set_activation_check") await saveActivationCheck(action.payload);
    return nextState;
  } finally {
    suppressLocalPersistence = false;
  }
}

export async function applyCrmActionsAsync(actions: CrmAction[]): Promise<CrmState> {
  globalForCrm.optiCrmState = await getCrmStateAsync();
  suppressLocalPersistence = true;
  try {
    for (const action of actions) applyCrmAction(action);
    await persistCrmStateAsync(globalForCrm.optiCrmState);
    return structuredClone(globalForCrm.optiCrmState);
  } finally {
    suppressLocalPersistence = false;
  }
}

export async function persistCredentialsAsync() {
  if (!supabasePersistenceEnabled()) return;
  await writeSupabaseValue(credentialsKey, getCredentialsSnapshot());
}

export async function saveAiCallAnalysisAsync(input: {
  leadId: string;
  ownerId: string;
  transcript: string;
  recordingUrl?: string;
  analysis: {
    summary: string;
    pain: string;
    currentPromotionChannels: string;
    budget: string;
    objections: string[];
    nextSteps: string[];
    suggestedWarmupContent: string;
    interest: number;
    dealProbability: number;
    managerMistakes: string[];
  };
}) {
  globalForCrm.optiCrmState = await getCrmStateAsync();
  const state = globalForCrm.optiCrmState;
  const lead = state.leads.find((item) => item.id === input.leadId);
  const owner = state.users.find((item) => item.id === input.ownerId && item.status === "active");
  if (!lead || !owner) throw new Error("Лид или сотрудник не найден.");

  const call: CrmState["callRecords"][number] = {
    id: id(),
    leadId: lead.id,
    ownerId: owner.id,
    recordingUrl: input.recordingUrl?.trim() || "",
    transcript: input.transcript.trim(),
    summary: input.analysis.summary,
    objections: input.analysis.objections,
    nextSteps: input.analysis.suggestedWarmupContent
      ? [...input.analysis.nextSteps, `Контент для прогрева: ${input.analysis.suggestedWarmupContent}`]
      : input.analysis.nextSteps,
    interest: input.analysis.interest,
    dealProbability: input.analysis.dealProbability,
    managerMistakes: input.analysis.managerMistakes,
    createdAt: today()
  };
  state.callRecords.unshift(call);
  owner.calls += 1;
  lead.lastContactAt = today();
  if (input.analysis.pain) lead.pain = input.analysis.pain;
  if (input.analysis.currentPromotionChannels) lead.currentPromotionChannels = input.analysis.currentPromotionChannels;
  if (input.analysis.budget) lead.budget = input.analysis.budget;
  lead.nextStep = input.analysis.nextSteps[0] ?? lead.nextStep;
  lead.score = Math.min(100, Math.round((scoreLead(lead) + input.analysis.interest + input.analysis.dealProbability) / 3));
  lead.temperature = temperature(lead.score);
  addActivity(state, lead.id, "call", "AI-анализ звонка", input.analysis.summary);
  await persistCrmStateAsync(state);
  return structuredClone(call);
}

export async function setIntegrationStatusAsync(integrationId: string, status: CrmState["integrations"][number]["status"]) {
  globalForCrm.optiCrmState = await getCrmStateAsync();
  const integration = globalForCrm.optiCrmState.integrations.find((item) => item.id === integrationId);
  if (!integration) throw new Error("Интеграция не найдена.");
  integration.status = status;
  integration.updatedAt = today();
  await persistCrmStateAsync(globalForCrm.optiCrmState);
}

export function dashboardMetrics(state: CrmState): DashboardMetrics {
  const activeSubscriptions = state.subscriptions.filter((item) => item.status === "active");
  const mrr = activeSubscriptions.reduce((sum, subscription) => {
    const tariff = state.tariffs.find((item) => item.id === subscription.tariffId);
    return sum + (tariff?.price ?? 0);
  }, 0);
  const paidPayments = state.payments.filter((item) => item.status === "paid");
  const paidRevenue = paidPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const payingLeadIds = new Set(paidPayments.map((payment) => payment.leadId));
  const deals = payingLeadIds.size;
  const cancelledSubscriptions = state.subscriptions.filter((item) => item.status === "cancelled");
  const customerSubscriptions = [...activeSubscriptions, ...cancelledSubscriptions];
  const churn = customerSubscriptions.length ? roundPercent(cancelledSubscriptions.length / customerSubscriptions.length) : 0;
  const ltv = deals ? Math.round(paidRevenue / deals) : 0;
  const todayKey = moscowDateKey();
  const lifetimeDays = customerSubscriptions.map((subscription) => {
    const startedAt = subscription.startedAt.slice(0, 10);
    const contractualEnd = subscription.endsAt.slice(0, 10);
    const effectiveEnd = subscription.status === "active" && todayKey < contractualEnd ? todayKey : contractualEnd;
    return Math.max(0, daysBetweenCalendarDates(startedAt, effectiveEnd));
  });
  const averageLifetimeMonths = lifetimeDays.length
    ? Math.round((lifetimeDays.reduce((sum, days) => sum + days, 0) / lifetimeDays.length / 30.44) * 10) / 10
    : 0;
  const reachedStage = (lead: Lead, stage: number) => {
    if (stage === 0 || lead.stage === stage) return true;
    if (lead.stage !== 6 && lead.stage >= stage) return true;
    return state.activities.some((activity) => activity.leadId === lead.id && activity.type === "stage" && activity.detail === STAGES[stage]);
  };
  const stageConversions = STAGES.slice(0, -2).map((_, from) => {
    const to = from + 1;
    const entered = state.leads.filter((lead) => reachedStage(lead, from)).length;
    const advanced = state.leads.filter((lead) => reachedStage(lead, to)).length;
    return { from, to, entered, advanced, conversion: entered ? roundPercent(advanced / entered) : 0 };
  });
  const channelNames = [...new Set(state.leads.map((lead) => lead.sourceChannel || "Не указан"))];
  const channels = channelNames.map((channel) => {
    const leads = state.leads.filter((lead) => (lead.sourceChannel || "Не указан") === channel);
    const leadIds = new Set(leads.map((lead) => lead.id));
    const channelDeals = [...payingLeadIds].filter((leadId) => leadIds.has(leadId)).length;
    const revenue = paidPayments.filter((payment) => leadIds.has(payment.leadId)).reduce((sum, payment) => sum + payment.amount, 0);
    return { channel, leads: leads.length, deals: channelDeals, revenue, conversion: leads.length ? roundPercent(channelDeals / leads.length) : 0 };
  }).sort((a, b) => b.leads - a.leads || b.revenue - a.revenue);
  const managers = state.users.filter((user) => user.status === "active").map((user) => {
    const leads = state.leads.filter((lead) => lead.ownerId === user.id);
    const leadIds = new Set(leads.map((lead) => lead.id));
    const managerDeals = [...payingLeadIds].filter((leadId) => leadIds.has(leadId)).length;
    const revenue = paidPayments.filter((payment) => leadIds.has(payment.leadId)).reduce((sum, payment) => sum + payment.amount, 0);
    const calls = state.activities.filter((activity) => activity.type === "call" && leadIds.has(activity.leadId) && (activity.title === "Дозвонились" || activity.title === "Назначена встреча")).length;
    return { userId: user.id, calls, meetings: user.meetings, deals: managerDeals, revenue, conversion: leads.length ? roundPercent(managerDeals / leads.length) : 0 };
  });
  return {
    leads: state.leads.length,
    calls: state.activities.filter((activity) => activity.type === "call" && (activity.title === "Дозвонились" || activity.title === "Назначена встреча")).length,
    deals,
    payments: paidPayments.length,
    paidRevenue,
    mrr,
    churn,
    ltv,
    averageLifetimeMonths,
    conversion: state.leads.length ? roundPercent(deals / state.leads.length) : 0,
    stageConversions,
    channels,
    managers
  };
}

export function salesPeriodMetrics(state: CrmState, user: CrmUser): SalesPeriodMetrics {
  const todayStart = moscowDateKey();
  const weekStart = moscowWeekStartDateKey();
  const monthStart = moscowMonthStartDateKey();
  const ownedLeadIds = new Set(
    state.leads
      .filter((lead) => user.role === "Менеджер по продажам" ? lead.ownerId === user.id : true)
      .map((lead) => lead.id)
  );
  const periods = { today: todayStart, week: weekStart, month: monthStart } as const;
  return Object.fromEntries(Object.entries(periods).map(([key, start]) => {
    const leads = state.leads.filter((lead) => ownedLeadIds.has(lead.id) && moscowDateKey(lead.createdAt) >= start).length;
    const actualContacts = state.activities.filter((activity) => ownedLeadIds.has(activity.leadId)
      && activity.type === "call"
      && (activity.title === "Дозвонились" || activity.title === "Назначена встреча")
      && moscowDateKey(activity.createdAt) >= start).length;
    const firstPayments = new Map<string, string>();
    state.payments.filter((payment) => payment.status === "paid" && ownedLeadIds.has(payment.leadId)).forEach((payment) => {
      const current = firstPayments.get(payment.leadId);
      if (!current || payment.paidAt < current) firstPayments.set(payment.leadId, payment.paidAt);
    });
    const firstPaidDeals = [...firstPayments.values()].filter((paidAt) => moscowDateKey(paidAt) >= start).length;
    return [key, { leads, actualContacts, firstPaidDeals }];
  })) as SalesPeriodMetrics;
}

function roundPercent(value: number) {
  return Math.round(value * 1000) / 10;
}
