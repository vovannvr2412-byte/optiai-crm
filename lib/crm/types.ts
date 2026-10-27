export type Role = "Руководитель" | "РОП" | "Менеджер" | "Аккаунт-менеджер" | "Технический специалист";
export type OsAppId = "leads" | "management" | "content" | "routines" | "settings" | "team";
export type UserStatus = "active" | "disabled";
export type LeadTemperature = "hot" | "warm" | "cold";
export type LeadStatus = "sales" | "warmup" | "client" | "lost";
export type IntegrationStatus = "connected" | "needs_setup" | "error";
export type TaskPriority = "high" | "medium" | "low";
export type ManualCallResult = "answered" | "no_answer" | "busy" | "invalid_number" | "other" | "meeting" | "comment";

export type ViewId =
  | "dashboard"
  | "management"
  | "tasks"
  | "pipeline"
  | "messengers"
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
  appPermissions?: OsAppId[];
  autoAssignEnabled?: boolean;
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
  projectName?: string;
  optiaiAccountId?: string;
  optiaiLogin?: string;
  preferredChannel?: "telegram" | "max" | "whatsapp" | "phone" | "email";
  telegramId?: string;
  maxContact?: string;
  whatsappContact?: string;
  substatus?: "Не отвечает" | "Отложено";
  expectedPaymentAt?: string;
  originalOwnerId?: string;
  scriptsSent?: boolean;
  scriptsSentAt?: string;
  sourceHistory?: LeadSourceEvent[];
  activationChecks?: LeadActivationCheck[];
};

export type LeadSourceEvent = { id: string; source: string; eventType: string; occurredAt: string };
export type LeadActivationCheckCode = "questionnaire_sent" | "questionnaire_received" | "integration_completed" | "keywords_approved" | "subscription_activated" | "days_added";
export type LeadActivationCheck = { code: LeadActivationCheckCode; completedAt?: string; completedBy?: string; notApplicable?: boolean };

export type Subscription = {
  id: string;
  leadId: string;
  tariffId: string;
  startedAt: string;
  endsAt: string;
  nextPaymentAt: string;
  contractMonths: number;
  status: "active" | "pending_payment" | "cancelled";
  externalId?: string;
  customPrice?: number;
};

export type Payment = {
  id: string;
  leadId: string;
  amount: number;
  paidAt: string;
  provider: "RoboKassa" | "manual";
  status: "paid" | "pending" | "failed";
  externalEventId?: string;
  isFirstPayment?: boolean;
};

export type ClientDocument = {
  id: string;
  leadId: string;
  externalId?: string;
  kind: "invoice" | "act" | "contract" | "other";
  title: string;
  status: string;
  fileUrl?: string;
  amount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CrmTask = {
  id: string;
  leadId: string;
  ownerId: string;
  title: string;
  dueAt: string;
  priority: TaskPriority;
  status: "open" | "done" | "cancelled";
  automationKey?: string;
  dueTime?: string;
  taskType?: "call" | "message" | "audit" | "case" | "proposal" | "other";
  description?: string;
  result?: string;
  manualOverride?: boolean;
  source?: "manual" | "warmup" | "automation" | "platform";
  history?: { at: string; action: string; detail?: string }[];
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
  callResult?: "answered" | "no_answer" | "busy" | "invalid_number" | "other";
  durationSeconds?: number;
  externalId?: string;
};

export type WarmupStep = {
  id: string;
  day: number;
  title: string;
  message: string;
  contentType: "VSL" | "SEO audit" | "Case" | "Competitor audit" | "Custom";
  attachmentUrl?: string;
  attachmentType?: "image" | "video";
  attachmentName?: string;
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
  clientDocuments?: ClientDocument[];
};

export type DashboardMetrics = {
  leads: number;
  calls: number;
  deals: number;
  payments: number;
  paidRevenue: number;
  mrr: number;
  churn: number;
  ltv: number;
  averageLifetimeMonths: number;
  conversion: number;
  stageConversions: { from: number; to: number; entered: number; advanced: number; conversion: number }[];
  channels: { channel: string; leads: number; deals: number; revenue: number; conversion: number }[];
  managers: { userId: string; calls: number; meetings: number; deals: number; revenue: number; conversion: number }[];
};

export type SalesPeriodMetrics = Record<"today" | "week" | "month", {
  leads: number;
  actualContacts: number;
  firstPaidDeals: number;
}>;

export type LeadUpdate = Partial<Omit<Lead, "id" | "status" | "score" | "temperature" | "createdAt">>;

export type CrmAction =
  | { type: "create_user"; payload: Pick<CrmUser, "fullName" | "email" | "role" | "position"> & { password: string } }
  | { type: "update_owner_profile"; payload: { userId: string } & Pick<CrmUser, "fullName" | "email" | "position"> }
  | { type: "disable_user"; payload: { userId: string } }
  | { type: "delete_user"; payload: { userId: string } }
  | { type: "update_user_access"; payload: { userId: string; appPermissions: OsAppId[]; autoAssignEnabled: boolean } }
  | { type: "complete_task"; payload: { taskId: string } }
  | { type: "reschedule_task"; payload: { taskId: string; dueAt: string } }
  | { type: "cancel_task"; payload: { taskId: string } }
  | { type: "create_lead"; payload: Omit<Lead, "id" | "stage" | "status" | "score" | "temperature" | "createdAt"> }
  | { type: "update_lead"; payload: { leadId: string; changes: LeadUpdate } }
  | { type: "update_lead_operations"; payload: { leadId: string; changes: { projectName?: string; optiaiAccountId?: string; optiaiLogin?: string; preferredChannel?: Lead["preferredChannel"]; telegramId?: string; maxContact?: string; whatsappContact?: string; substatus?: Lead["substatus"] | null; expectedPaymentAt?: string | null } } }
  | { type: "set_activation_check"; payload: { leadId: string; code: LeadActivationCheckCode; completed: boolean; notApplicable?: boolean; actorId: string } }
  | { type: "set_scripts_sent"; payload: { leadId: string; completed: boolean; actorId: string } }
  | { type: "delete_lead"; payload: { leadId: string } }
  | { type: "move_stage"; payload: { leadId: string; stage: number } }
  | { type: "assign_lead"; payload: { leadId: string; ownerId: string } }
  | { type: "record_call"; payload: { leadId: string; ownerId: string } }
  | { type: "mark_no_answer"; payload: { leadId: string; ownerId: string } }
  | { type: "record_call_result"; payload: { leadId: string; ownerId: string; result: ManualCallResult; comment?: string } }
  | { type: "import_sip_call"; payload: { externalId: string; leadId: string; ownerId: string; result: Exclude<ManualCallResult, "meeting" | "comment">; durationSeconds: number; recordingUrl?: string } }
  | { type: "connect_lead"; payload: { leadId: string } }
  | { type: "send_message"; payload: { leadId: string; channel: string; text: string } }
  | { type: "start_warmup"; payload: { leadId: string; sequenceId: string } }
  | { type: "create_warmup_sequence"; payload: { name: string; description: string; active: boolean } }
  | { type: "update_warmup_sequence"; payload: { sequenceId: string; name: string; description: string; active: boolean } }
  | { type: "delete_warmup_sequence"; payload: { sequenceId: string } }
  | { type: "create_warmup_step"; payload: { sequenceId: string; day: number; title: string; message: string; contentType?: WarmupStep["contentType"]; attachmentUrl?: string; attachmentType?: "image" | "video"; attachmentName?: string } }
  | { type: "update_warmup_step"; payload: { sequenceId: string; stepId: string; day: number; title: string; message: string; contentType: WarmupStep["contentType"]; attachmentUrl?: string | null; attachmentType?: "image" | "video" | null; attachmentName?: string | null } }
  | { type: "delete_warmup_step"; payload: { sequenceId: string; stepId: string } }
  | { type: "mark_paid"; payload: { leadId: string; tariffId: string } }
  | { type: "mark_refused"; payload: { leadId: string; reason: string } }
  | { type: "renew_subscription"; payload: { subscriptionId: string } }
  | { type: "run_automation"; payload: { key: "no_answer_3" | "no_answer_7" | "no_answer_14" | "missed_call" } }
  | { type: "toggle_integration"; payload: { integrationId: string } }
  | { type: "configure_integration"; payload: { integrationId: string; config: Record<string, string> } };

export const STAGES = [
  "Новый лид",
  "Прогрев",
  "Планирует оплату",
  "Оплата и подключение",
  "Подключён",
  "Не продлил подписку",
  "Отказ"
] as const;

export const ROLE_PERMISSIONS: Record<Role, ViewId[]> = {
  Руководитель: ["dashboard", "management", "tasks", "pipeline", "messengers", "lead", "callcenter", "warmup", "subscriptions", "team", "automations"],
  РОП: ["dashboard", "tasks", "pipeline", "messengers", "lead", "callcenter", "warmup", "team"],
  Менеджер: ["dashboard", "tasks", "pipeline", "messengers", "lead", "callcenter", "warmup"],
  "Аккаунт-менеджер": ["dashboard", "management", "tasks", "messengers", "lead", "callcenter", "subscriptions"],
  "Технический специалист": ["dashboard", "tasks", "pipeline", "lead", "callcenter", "automations"]
};

export const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: "Дашборд",
  management: "Обзор компании",
  tasks: "Задачи",
  pipeline: "Воронка",
  messengers: "Мессенджеры",
  lead: "Карточка",
  callcenter: "Call Center",
  warmup: "Прогрев",
  subscriptions: "Подписки",
  team: "Команда",
  automations: "Автоматизации"
};
