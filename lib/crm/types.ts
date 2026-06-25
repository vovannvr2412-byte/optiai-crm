export type Role = "Руководитель" | "РОП" | "Менеджер" | "Аккаунт-менеджер";
export type UserStatus = "active" | "disabled";
export type LeadTemperature = "hot" | "warm" | "cold";
export type LeadStatus = "sales" | "warmup" | "client" | "lost";
export type IntegrationStatus = "connected" | "needs_setup" | "error";
export type TaskPriority = "high" | "medium" | "low";

export type ViewId =
  | "dashboard"
  | "pipeline"
  | "lead"
  | "callcenter"
  | "warmup"
  | "subscriptions"
  | "team"
  | "automations";

export type CrmUser = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  position: string;
  status: UserStatus;
  calls: number;
  meetings: number;
  revenue: number;
  conversion: number;
  createdAt: string;
};

export type Tariff = {
  id: string;
  name: "SEO + GEO Start" | "SEO + GEO Growth" | "SEO + GEO Dominance";
  price: number;
};

export type Lead = {
  id: string;
  companyName: string;
  site: string;
  industry: string;
  companySize: string;
  region: string;
  contactName: string;
  contactRole: string;
  phone: string;
  email: string;
  telegram: string;
  whatsapp: string;
  max: string;
  hasSeo: boolean | null;
  hasContext: boolean | null;
  hasMarketer: boolean | null;
  hasAgency: boolean | null;
  brandedQueries: number | null;
  llmVisibility: number | null;
  geoPotential: "Высокий" | "Средний" | "Низкий" | "Новый";
  stage: number;
  status: LeadStatus;
  sourceChannel: string;
  sourceDetail: string;
  ownerId: string;
  score: number;
  temperature: LeadTemperature;
  pain: string;
  currentPromotionChannels: string;
  budget: string;
  nextStep: string;
  refusalReason?: string;
  lastContactAt?: string;
  createdAt: string;
  tariffId?: string;
};

export type Subscription = {
  id: string;
  leadId: string;
  tariffId: string;
  startedAt: string;
  endsAt: string;
  nextPaymentAt: string;
  contractMonths: number;
  status: "active" | "pending_payment" | "cancelled";
};

export type Payment = {
  id: string;
  leadId: string;
  amount: number;
  paidAt: string;
  provider: "RoboKassa" | "manual";
  status: "paid" | "pending" | "failed";
};

export type CrmTask = {
  id: string;
  leadId: string;
  ownerId: string;
  title: string;
  dueAt: string;
  priority: TaskPriority;
  status: "open" | "done";
  automationKey?: string;
};

export type Activity = {
  id: string;
  leadId: string;
  type: "message" | "call" | "task" | "stage" | "payment" | "warmup" | "system";
  title: string;
  detail: string;
  createdAt: string;
};

export type CallRecord = {
  id: string;
  leadId: string;
  ownerId: string;
  recordingUrl: string;
  transcript: string;
  summary: string;
  objections: string[];
  nextSteps: string[];
  interest: number;
  dealProbability: number;
  managerMistakes: string[];
  createdAt: string;
};

export type WarmupStep = {
  id: string;
  day: number;
  title: string;
  message: string;
  contentType: "VSL" | "SEO audit" | "Case" | "Competitor audit" | "Custom";
};

export type WarmupSequence = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  steps: WarmupStep[];
};

export type Integration = {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  config?: Record<string, string>;
  updatedAt?: string;
};

export type CrmState = {
  users: CrmUser[];
  tariffs: Tariff[];
  leads: Lead[];
  subscriptions: Subscription[];
  payments: Payment[];
  tasks: CrmTask[];
  activities: Activity[];
  callRecords: CallRecord[];
  warmupSequences: WarmupSequence[];
  integrations: Integration[];
};

export type CrmAction =
  | { type: "create_user"; payload: Pick<CrmUser, "fullName" | "email" | "role" | "position"> & { password: string } }
  | { type: "disable_user"; payload: { userId: string } }
  | { type: "delete_user"; payload: { userId: string } }
  | { type: "create_lead"; payload: Omit<Lead, "id" | "stage" | "status" | "score" | "temperature" | "createdAt"> }
  | { type: "move_stage"; payload: { leadId: string; stage: number } }
  | { type: "assign_lead"; payload: { leadId: string; ownerId: string } }
  | { type: "record_call"; payload: { leadId: string; ownerId: string } }
  | { type: "mark_no_answer"; payload: { leadId: string; ownerId: string } }
  | { type: "send_message"; payload: { leadId: string; channel: string; text: string } }
  | { type: "start_warmup"; payload: { leadId: string; sequenceId: string } }
  | { type: "create_warmup_step"; payload: { sequenceId: string; day: number; title: string; message: string } }
  | { type: "mark_paid"; payload: { leadId: string; tariffId: string } }
  | { type: "mark_refused"; payload: { leadId: string; reason: string } }
  | { type: "renew_subscription"; payload: { subscriptionId: string } }
  | { type: "run_automation"; payload: { key: "no_answer_3" | "no_answer_7" | "no_answer_14" | "missed_call" } }
  | { type: "toggle_integration"; payload: { integrationId: string } }
  | { type: "configure_integration"; payload: { integrationId: string; config: Record<string, string> } };

export const STAGES = [
  "Новый лид",
  "Контакт найден",
  "Первый звонок",
  "Не дозвонились",
  "Разговор состоялся",
  "Отправлен аудит",
  "Прогрев",
  "Сделка или отказ",
  "Оплата",
  "Подключен",
  "Продление",
  "Апселл",
  "Отказ"
] as const;

export const ROLE_PERMISSIONS: Record<Role, ViewId[]> = {
  Руководитель: ["dashboard", "pipeline", "lead", "callcenter", "warmup", "subscriptions", "team", "automations"],
  РОП: ["dashboard", "pipeline", "lead", "callcenter", "warmup", "subscriptions", "team"],
  Менеджер: ["pipeline", "lead", "callcenter", "warmup"],
  "Аккаунт-менеджер": ["dashboard", "lead", "callcenter", "subscriptions"]
};

export const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: "Дашборд",
  pipeline: "Воронка",
  lead: "Карточка",
  callcenter: "Call Center",
  warmup: "Прогрев",
  subscriptions: "Подписки",
  team: "Команда",
  automations: "Автоматизации"
};
