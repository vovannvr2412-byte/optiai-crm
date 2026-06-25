import type { Activity, CallRecord, CrmState, CrmTask, CrmUser, Integration, Lead, Payment, Subscription, Tariff, WarmupSequence } from "./types";

const now = "2026-06-25T00:00:00.000Z";

export const seedUsers: CrmUser[] = [
  { id: "u-owner", fullName: "Владимир Орлов", email: "owner@optiai.ru", role: "Руководитель", position: "CEO OptiAI", status: "active", calls: 0, meetings: 0, revenue: 0, conversion: 0, createdAt: now },
  { id: "u-rop", fullName: "Екатерина Нечаева", email: "rop@optiai.ru", role: "РОП", position: "Руководитель отдела продаж", status: "active", calls: 0, meetings: 0, revenue: 0, conversion: 0, createdAt: now }
];

export const seedTariffs: Tariff[] = [
  { id: "t-start", name: "SEO + GEO Start", price: 14900 },
  { id: "t-growth", name: "SEO + GEO Growth", price: 71400 },
  { id: "t-dominance", name: "SEO + GEO Dominance", price: 118800 }
];

export const seedLeads: Lead[] = [];
export const seedSubscriptions: Subscription[] = [];
export const seedPayments: Payment[] = [];
export const seedTasks: CrmTask[] = [];
export const seedActivities: Activity[] = [];
export const seedCalls: CallRecord[] = [];

export const seedWarmups: WarmupSequence[] = [
  {
    id: "w-default",
    name: "SEO + GEO прогрев после первого контакта",
    description: "Базовая цепочка из ТЗ: VSL, SEO-аудит, кейс, аудит конкурентов.",
    active: true,
    steps: [
      { id: "ws-1", day: 1, title: "VSL с обзором платформы", message: "Отправить VSL с обзором OptiAI и принципом SEO + GEO на автопилоте.", contentType: "VSL" },
      { id: "ws-2", day: 2, title: "SEO аудит и потенциал сайта", message: "Отправить персональный SEO-аудит, GEO-потенциал и текущую LLM-видимость.", contentType: "SEO audit" },
      { id: "ws-3", day: 4, title: "Кейс из смежной ниши", message: "Подобрать кейс по отрасли и боли клиента.", contentType: "Case" },
      { id: "ws-4", day: 5, title: "Аудит конкурентов", message: "Показать упущенный спрос, конкурентов и потенциал роста.", contentType: "Competitor audit" }
    ]
  }
];

export const seedIntegrations: Integration[] = [
  { id: "telegram", name: "Telegram Bot API", description: "Отправка и получение сообщений", status: "needs_setup" },
  { id: "whatsapp", name: "WhatsApp Business API", description: "Шаблоны, входящие и исходящие диалоги", status: "needs_setup" },
  { id: "max", name: "MAX", description: "Сообщения и история переписки", status: "needs_setup" },
  { id: "instagram", name: "Instagram", description: "Direct, Reels, комментарии, лид-магниты", status: "needs_setup" },
  { id: "avito", name: "Avito", description: "Сообщения, заявки и звонки", status: "needs_setup" },
  { id: "sheets", name: "Google Sheets", description: "Экспорт и сверка данных", status: "needs_setup" },
  { id: "metrika", name: "Яндекс Метрика", description: "Посещения сайта и конверсии", status: "needs_setup" },
  { id: "robokassa", name: "RoboKassa", description: "Оплаты подписок", status: "needs_setup" },
  { id: "sip", name: "SIP-телефония", description: "Звонки, записи, автодозвон", status: "needs_setup" }
];

export function createSeedState(): CrmState {
  return {
    users: structuredClone(seedUsers),
    tariffs: structuredClone(seedTariffs),
    leads: structuredClone(seedLeads),
    subscriptions: structuredClone(seedSubscriptions),
    payments: structuredClone(seedPayments),
    tasks: structuredClone(seedTasks),
    activities: structuredClone(seedActivities),
    callRecords: structuredClone(seedCalls),
    warmupSequences: structuredClone(seedWarmups),
    integrations: structuredClone(seedIntegrations)
  };
}
