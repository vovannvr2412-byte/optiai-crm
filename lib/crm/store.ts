import { createSeedState } from "./seed";
import { disableCredential, registerCredential } from "@/lib/auth/credentials";
import { STAGES, type CrmAction, type CrmState, type Lead, type LeadTemperature, type Role } from "./types";

const globalForCrm = globalThis as unknown as { optiCrmState?: CrmState };

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
  if (!globalForCrm.optiCrmState) {
    globalForCrm.optiCrmState = createSeedState();
  }
  return globalForCrm.optiCrmState;
}

export function resetCrmState() {
  globalForCrm.optiCrmState = createSeedState();
  return getCrmState();
}

export function cloneState() {
  return structuredClone(getCrmState());
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
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.role === "Руководитель" || user.role === "РОП") return state;
  if (user.role === "Менеджер") {
    const allowedLeadIds = new Set(state.leads.filter((lead) => lead.ownerId === user.id && lead.status !== "client").map((lead) => lead.id));
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
        addTask(state, lead.id, lead.ownerId, "Перезвонить через 1 день", 1, "high", "missed_call");
        addTask(state, lead.id, lead.ownerId, "Перезвонить через 3 дня", 3, "medium", "missed_call");
        addTask(state, lead.id, lead.ownerId, "Перезвонить через 7 дней", 7, "medium", "missed_call");
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
        addTask(state, lead.id, lead.ownerId, "Перезвонить после недозвона", 1, "high", "missed_call");
      }
    });
  }

  if (action.type === "toggle_integration") {
    const integration = state.integrations.find((item) => item.id === action.payload.integrationId);
    if (integration) {
      integration.status = integration.status === "connected" ? "needs_setup" : "connected";
    }
  }

  return cloneState();
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
