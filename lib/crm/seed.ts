import type { Activity, CallRecord, CrmState, CrmTask, CrmUser, Integration, Lead, Payment, Subscription, Tariff, WarmupSequence } from "./types";

const now = "2026-06-21T20:00:00.000Z";

export const seedUsers: CrmUser[] = [
  { id: "u-owner", fullName: "Владимир Орлов", email: "owner@optiai.ru", role: "Руководитель", position: "CEO OptiAI", status: "active", calls: 18, meetings: 9, revenue: 1945000, conversion: 34, createdAt: now },
  { id: "u-rop", fullName: "Екатерина Нечаева", email: "rop@optiai.ru", role: "РОП", position: "Руководитель отдела продаж", status: "active", calls: 36, meetings: 18, revenue: 1324000, conversion: 27, createdAt: now },
  { id: "u-anna", fullName: "Анна Власова", email: "anna@optiai.ru", role: "Менеджер", position: "Senior sales manager", status: "active", calls: 58, meetings: 14, revenue: 842000, conversion: 21, createdAt: now },
  { id: "u-ilya", fullName: "Илья Морозов", email: "ilya@optiai.ru", role: "Менеджер", position: "Sales manager", status: "active", calls: 47, meetings: 11, revenue: 617000, conversion: 18, createdAt: now },
  { id: "u-sofia", fullName: "София Лебедева", email: "sofia@optiai.ru", role: "Аккаунт-менеджер", position: "Account manager", status: "active", calls: 39, meetings: 9, revenue: 486000, conversion: 16, createdAt: now }
];

export const seedTariffs: Tariff[] = [
  { id: "t-start", name: "SEO + GEO Start", price: 14900 },
  { id: "t-growth", name: "SEO + GEO Growth", price: 71400 },
  { id: "t-dominance", name: "SEO + GEO Dominance", price: 118800 }
];

export const seedLeads: Lead[] = [
  {
    id: "l-nord",
    companyName: "Nord Clinic",
    site: "nordclinic.ru",
    industry: "Медицина",
    companySize: "120 сотрудников",
    region: "Санкт-Петербург",
    contactName: "Ирина Соколова",
    contactRole: "Маркетолог",
    phone: "+7 921 440-18-22",
    email: "sokolova@nordclinic.ru",
    telegram: "@sokolova_nord",
    whatsapp: "+7 921 440-18-22",
    max: "irina.nord",
    hasSeo: true,
    hasContext: true,
    hasMarketer: true,
    hasAgency: true,
    brandedQueries: 8400,
    llmVisibility: 18,
    geoPotential: "Высокий",
    stage: 6,
    status: "warmup",
    sourceChannel: "Instagram",
    sourceDetail: "Reels",
    ownerId: "u-anna",
    score: 88,
    temperature: "hot",
    pain: "Дорогие лиды из Яндекс Директа",
    currentPromotionChannels: "SEO-подрядчик, Яндекс Директ, Instagram",
    budget: "180 000 ₽/мес",
    nextStep: "Отправить кейс CPL -47% и конкурентный аудит",
    lastContactAt: "2026-06-20T12:00:00.000Z",
    createdAt: "2026-06-14T09:00:00.000Z",
    tariffId: "t-growth"
  },
  {
    id: "l-metal",
    companyName: "MetalPro",
    site: "metalpro.ru",
    industry: "B2B производство",
    companySize: "260 сотрудников",
    region: "Екатеринбург",
    contactName: "Алексей Романов",
    contactRole: "Коммерческий директор",
    phone: "+7 903 118-44-91",
    email: "sales@metalpro.ru",
    telegram: "@romanov_metal",
    whatsapp: "+7 903 118-44-91",
    max: "romanov",
    hasSeo: false,
    hasContext: true,
    hasMarketer: false,
    hasAgency: false,
    brandedQueries: 2100,
    llmVisibility: 4,
    geoPotential: "Высокий",
    stage: 3,
    status: "sales",
    sourceChannel: "Cold Call",
    sourceDetail: "база компаний",
    ownerId: "u-anna",
    score: 73,
    temperature: "warm",
    pain: "Нет системного входящего спроса",
    currentPromotionChannels: "Яндекс Директ, холодные продажи",
    budget: "90 000 ₽/мес",
    nextStep: "Перезвонить сегодня",
    lastContactAt: "2026-06-18T10:00:00.000Z",
    createdAt: "2026-06-12T09:30:00.000Z",
    tariffId: "t-start"
  },
  {
    id: "l-home",
    companyName: "HomeLine",
    site: "homeline.ru",
    industry: "Недвижимость",
    companySize: "35 сотрудников",
    region: "Москва",
    contactName: "Мария Белова",
    contactRole: "Владелец",
    phone: "+7 926 515-91-07",
    email: "maria@homeline.ru",
    telegram: "@belova_home",
    whatsapp: "+7 926 515-91-07",
    max: "belova.home",
    hasSeo: true,
    hasContext: false,
    hasMarketer: true,
    hasAgency: false,
    brandedQueries: 5700,
    llmVisibility: 11,
    geoPotential: "Средний",
    stage: 10,
    status: "client",
    sourceChannel: "Avito",
    sourceDetail: "заявка",
    ownerId: "u-sofia",
    score: 91,
    temperature: "hot",
    pain: "Мало заявок из органики",
    currentPromotionChannels: "Avito, SEO, рекомендации",
    budget: "150 000 ₽/мес",
    nextStep: "Подготовить отчет для продления",
    lastContactAt: "2026-06-19T15:30:00.000Z",
    createdAt: "2026-05-20T09:00:00.000Z",
    tariffId: "t-dominance"
  },
  {
    id: "l-edu",
    companyName: "EduWave",
    site: "eduwave.ru",
    industry: "EdTech",
    companySize: "80 сотрудников",
    region: "Казань",
    contactName: "Денис Кравцов",
    contactRole: "CEO",
    phone: "+7 916 201-33-19",
    email: "denis@eduwave.ru",
    telegram: "@eduwave_denis",
    whatsapp: "+7 916 201-33-19",
    max: "denis.eduwave",
    hasSeo: false,
    hasContext: true,
    hasMarketer: true,
    hasAgency: true,
    brandedQueries: 12600,
    llmVisibility: 7,
    geoPotential: "Высокий",
    stage: 2,
    status: "sales",
    sourceChannel: "Telegram ads",
    sourceDetail: "сообщение",
    ownerId: "u-ilya",
    score: 67,
    temperature: "warm",
    pain: "Низкая видимость в AI-ответах",
    currentPromotionChannels: "Telegram ads, Яндекс Директ",
    budget: "110 000 ₽/мес",
    nextStep: "Первый звонок в 15:00",
    lastContactAt: "2026-06-21T09:20:00.000Z",
    createdAt: "2026-06-21T08:30:00.000Z",
    tariffId: "t-growth"
  },
  {
    id: "l-fresh",
    companyName: "FreshDent",
    site: "freshdent.ru",
    industry: "Стоматология",
    companySize: "42 сотрудника",
    region: "Новосибирск",
    contactName: "Олег Миронов",
    contactRole: "Управляющий",
    phone: "+7 999 330-73-11",
    email: "info@freshdent.ru",
    telegram: "@freshdent_oleg",
    whatsapp: "+7 999 330-73-11",
    max: "oleg.fd",
    hasSeo: true,
    hasContext: true,
    hasMarketer: false,
    hasAgency: true,
    brandedQueries: 3900,
    llmVisibility: 15,
    geoPotential: "Средний",
    stage: 12,
    status: "lost",
    sourceChannel: "Яндекс директ",
    sourceDetail: "заявка",
    ownerId: "u-ilya",
    score: 31,
    temperature: "cold",
    pain: "Не готов к бюджету",
    currentPromotionChannels: "SEO, Яндекс Директ",
    budget: "30 000 ₽/мес",
    nextStep: "Запустить реактивацию через 30 дней",
    refusalReason: "Не готов к бюджету",
    lastContactAt: "2026-06-07T11:30:00.000Z",
    createdAt: "2026-06-01T09:00:00.000Z",
    tariffId: "t-start"
  }
];

export const seedSubscriptions: Subscription[] = [
  { id: "s-home", leadId: "l-home", tariffId: "t-dominance", startedAt: "2026-05-30", endsAt: "2026-08-30", nextPaymentAt: "2026-06-30", contractMonths: 3, status: "active" }
];

export const seedPayments: Payment[] = [
  { id: "p-home-1", leadId: "l-home", amount: 118800, paidAt: "2026-05-30", provider: "RoboKassa", status: "paid" }
];

export const seedTasks: CrmTask[] = [
  { id: "task-metal-1", leadId: "l-metal", ownerId: "u-anna", title: "Перезвонить после недозвона", dueAt: "2026-06-21", priority: "high", status: "open", automationKey: "missed_call" },
  { id: "task-home-1", leadId: "l-home", ownerId: "u-sofia", title: "Подготовить отчет к продлению", dueAt: "2026-06-22", priority: "high", status: "open" },
  { id: "task-nord-1", leadId: "l-nord", ownerId: "u-anna", title: "Отправить кейс CPL -47%", dueAt: "2026-06-21", priority: "medium", status: "open" }
];

export const seedActivities: Activity[] = seedLeads.flatMap((lead) => [
  { id: `a-${lead.id}-created`, leadId: lead.id, type: "system", title: "Карточка создана", detail: `${lead.sourceChannel}: ${lead.sourceDetail}`, createdAt: lead.createdAt },
  { id: `a-${lead.id}-stage`, leadId: lead.id, type: "stage", title: "Текущий этап", detail: `Этап ${lead.stage + 1}`, createdAt: lead.lastContactAt || lead.createdAt }
]);

export const seedCalls: CallRecord[] = [
  {
    id: "c-nord-1",
    leadId: "l-nord",
    ownerId: "u-anna",
    recordingUrl: "/recordings/demo-nord.mp3",
    transcript: "Клиент жалуется на рост стоимости Яндекс Директа и хочет канал, который будет давать органический спрос.",
    summary: "Интерес высокий. Нужен персональный аудит, кейс по снижению CPL и расчет окупаемости.",
    objections: ["Нужно доказать окупаемость", "Есть текущий подрядчик по SEO"],
    nextSteps: ["Отправить SEO + GEO аудит", "Показать кейс CPL -47%", "Назначить следующий звонок"],
    interest: 84,
    dealProbability: 78,
    managerMistakes: ["Не закреплена точная дата следующего контакта"],
    createdAt: "2026-06-20T12:05:00.000Z"
  }
];

export const seedWarmups: WarmupSequence[] = [
  {
    id: "w-default",
    name: "SEO + GEO прогрев после первого контакта",
    description: "Базовая цепочка из ТЗ: VSL, аудит, кейс, конкурентный аудит.",
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
  { id: "telegram", name: "Telegram Bot API", description: "Отправка и получение сообщений", status: "connected" },
  { id: "whatsapp", name: "WhatsApp Business API", description: "Шаблоны, входящие и исходящие диалоги", status: "connected" },
  { id: "max", name: "MAX", description: "Сообщения и история переписки", status: "needs_setup" },
  { id: "instagram", name: "Instagram", description: "Direct, Reels, комментарии, лид-магниты", status: "connected" },
  { id: "avito", name: "Avito", description: "Сообщения, заявки и звонки", status: "connected" },
  { id: "sheets", name: "Google Sheets", description: "Экспорт и сверка данных", status: "connected" },
  { id: "metrika", name: "Яндекс Метрика", description: "Посещения сайта и конверсии", status: "connected" },
  { id: "robokassa", name: "RoboKassa", description: "Оплаты подписок", status: "connected" },
  { id: "sip", name: "SIP-телефония", description: "Звонки, записи, автодозвон", status: "connected" }
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
