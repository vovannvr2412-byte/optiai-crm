"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Bell,
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  CheckSquare2,
  Clock3,
  Flame,
  Film,
  ImageIcon,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  MessagesSquare,
  Pencil,
  PhoneCall,
  PhoneOff,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  X
} from "lucide-react";
import { ROLE_PERMISSIONS, STAGES, VIEW_TITLES, type CrmAction, type CrmState, type CrmUser, type DashboardMetrics, type Lead, type ManualCallResult, type OsAppId, type Role, type SalesPeriodMetrics, type ViewId } from "@/lib/crm/types";
import { MessengerCenter } from "@/components/messenger-center";
import type { MessengerChannel, MessengerConnection } from "@/lib/messaging/types";
import { uploadMediaFile } from "@/lib/media/client";
import { AccountPasswordForm } from "@/components/account-password-form";
import type { CrmNotification } from "@/lib/notifications/store";
import type { AutomationStatus } from "@/lib/automations/scheduler";
import { readApiJson, readApiJsonOrNull } from "@/lib/api/client";
import type { AiConfigurationSummary } from "@/lib/ai/types";
import { OS_APPS, appAccessFor } from "@/lib/os/apps";

type Bootstrap = {
  currentUser: CrmUser;
  state: CrmState;
  metrics: DashboardMetrics;
  salesMetrics: SalesPeriodMetrics;
  notifications?: CrmNotification[];
  automationStatus?: AutomationStatus;
  auditLog?: {
    id: number;
    actorEmail: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId?: string;
    details: Record<string, unknown>;
    createdAt: string;
  }[];
};

const auditActionLabels: Record<string, string> = {
  "auth.login": "Вход в CRM",
  "auth.password_changed": "Пароль изменен",
  "user.invited": "Сотрудник приглашен",
  "user.created": "Аккаунт сотрудника создан",
  "user.profile_updated": "Данные руководителя изменены",
  "user.disabled": "Аккаунт отключен",
  "user.deleted": "Аккаунт удален",
  "task.completed": "Задача выполнена",
  "task.rescheduled": "Задача перенесена",
  "task.cancelled": "Задача отменена",
  "call.result_recorded": "Результат звонка сохранён",
  "lead.assigned": "Лид переназначен",
  "lead.deleted": "Лид удален",
  "integration.configured": "Интеграция настроена",
  "integration.status_changed": "Статус интеграции изменен",
  "messenger.credentials_updated": "Ключи мессенджера обновлены",
  "messenger.credentials_deleted": "Ключи мессенджера удалены",
  "messenger.bot_replaced": "Telegram-бот заменён",
  "messenger.connection_checked": "Подключение мессенджера проверено",
  "warmup.sequence_created": "Цепочка прогрева создана",
  "warmup.sequence_updated": "Цепочка прогрева изменена",
  "warmup.sequence_deleted": "Цепочка прогрева удалена",
  "warmup.step_created": "Шаг прогрева создан",
  "warmup.step_updated": "Шаг прогрева изменён",
  "warmup.step_deleted": "Шаг прогрева удалён",
  "ai.configuration_updated": "Настройки AI обновлены",
  "ai.configuration_deleted": "Настройки AI удалены",
  "ai.connection_checked": "Подключение AI проверено",
  "ai.call_analyzed": "Звонок проанализирован AI"
};

type Modal = "newUser" | "ownerProfile" | "newLead" | "editLead" | "deleteLead" | "warmupSequence" | "warmupStep" | "assignWarmup" | "refusal" | "integration" | "password" | "rescheduleTask" | "callResult" | null;

const navItems: { id: ViewId; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", icon: LayoutDashboard },
  { id: "tasks", icon: CheckSquare2 },
  { id: "pipeline", icon: BriefcaseBusiness },
  { id: "messengers", icon: MessagesSquare },
  { id: "lead", icon: ShieldCheck },
  { id: "callcenter", icon: PhoneCall },
  { id: "warmup", icon: Flame },
  { id: "subscriptions", icon: CalendarClock },
  { id: "team", icon: UsersRound },
  { id: "automations", icon: Bot }
];

const roleDescriptions: Record<Role, string> = {
  Руководитель: "Полный доступ ко всем данным, деньгам, команде и интеграциям.",
  РОП: "Управляет продажами, командой, воронкой и прогнозом.",
  Менеджер: "Видит общую базу лидов, а изменяет назначенные ему сделки, задачи и прогревы.",
  "Аккаунт-менеджер": "Видит действующих клиентов, продления и удержание.",
  "Технический специалист": "Работает с лидами, подключениями и техническими настройками."
};

const activationCheckLabels = [
  ["questionnaire_sent", "Анкета отправлена"],
  ["questionnaire_received", "Анкета получена"],
  ["integration_completed", "Интеграция выполнена"],
  ["keywords_approved", "Ключевые слова согласованы"],
  ["subscription_activated", "Подписка активирована"],
  ["days_added", "Дни добавлены"]
] as const;

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

function subscriptionUsesKey(subscription: PushSubscription, publicKey: string) {
  const activeKey = subscription.options.applicationServerKey;
  if (!activeKey) return false;
  const current = new Uint8Array(activeKey);
  const expected = urlBase64ToUint8Array(publicKey);
  return current.length === expected.length && current.every((value, index) => value === expected[index]);
}

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

function dateLabel(value?: string) {
  if (!value) return "нет данных";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(new Date(value));
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function phoneHref(phone: string) {
  const normalized = phone.replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : "#";
}

function isIosDevice() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function deniedPushMessage() {
  if (isIosDevice()) {
    return "Уведомления запрещены для OptiAI CRM. Откройте Настройки iPhone → Уведомления → OptiAI CRM и включите «Допуск уведомлений».";
  }
  return "Уведомления запрещены для этого сайта. В настройках браузера откройте «Настройки сайта» → «Уведомления» → optiai-crm.vercel.app и выберите «Разрешить».";
}

function leadStatusForStage(stage: number): Lead["status"] {
  if (stage === 6) return "lost";
  if (stage === 4) return "client";
  if (stage === 1) return "warmup";
  return "sales";
}

type CrmAppMode = "leads" | "management" | "settings" | "team";

const modeViews: Record<CrmAppMode, ViewId[]> = {
  leads: ["dashboard", "tasks", "pipeline", "messengers", "lead", "callcenter", "warmup"],
  management: ["management", "subscriptions", "messengers", "lead"],
  settings: ["automations"],
  team: ["team"]
};

const modeApp = { leads: "leads", management: "management", settings: "settings", team: "team" } as const;
const modeTitle = { leads: "Лиды CRM", management: "Панель управления", settings: "Настройки", team: "Команда" } as const;

export function CrmApp({ mode = "leads" }: { mode?: CrmAppMode }) {
  const [referenceNow] = useState(() => Date.now());
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [query, setQuery] = useState("");
  const [temperature, setTemperature] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedWarmupSequenceId, setSelectedWarmupSequenceId] = useState("");
  const [selectedWarmupStepId, setSelectedWarmupStepId] = useState("");
  const [taskFilter, setTaskFilter] = useState<"open" | "done" | "cancelled">("open");
  const [salesPeriod, setSalesPeriod] = useState<"today" | "week" | "month">("week");
  const [managementPeriod, setManagementPeriod] = useState<"today" | "week" | "month">("month");
  const [managementClientFilter, setManagementClientFilter] = useState<"all" | "active" | "former">("all");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [toast, setToast] = useState("");
  const [loadingAction, setLoadingAction] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [draggingLeadId, setDraggingLeadId] = useState("");
  const [dropStage, setDropStage] = useState<number | null>(null);
  const [movingLeadIds, setMovingLeadIds] = useState<Set<string>>(() => new Set());
  const suppressLeadClickRef = useRef("");
  const browserNotifiedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/crm/bootstrap?app=${modeApp[mode]}`, { cache: "no-store" });
    if (response.status === 401) {
      setBootstrap(null);
      setAuthChecked(true);
      return false;
    }
    const data = await readApiJson<Bootstrap>(response);
    setBootstrap(data);
    const allowedForUser = ROLE_PERMISSIONS[data.currentUser.role].filter((view) => modeViews[mode].includes(view));
    const params = new URLSearchParams(window.location.search);
    const linkedLeadId = params.get("lead");
    const linkedView = params.get("view") as ViewId | null;
    setActiveView((current) => linkedLeadId && data.state.leads.some((lead) => lead.id === linkedLeadId)
      ? "pipeline"
      : linkedView && allowedForUser.includes(linkedView)
        ? linkedView
        : allowedForUser.includes(current) ? current : allowedForUser[0]);
    const rememberedLeadId = window.sessionStorage.getItem("optiai:selectedLeadId") ?? "";
    if (linkedLeadId && data.state.leads.some((lead) => lead.id === linkedLeadId)) {
      setSelectedLeadId(linkedLeadId);
    } else if (data.state.leads.some((lead) => lead.id === rememberedLeadId)) {
      setSelectedLeadId(rememberedLeadId);
    } else {
      setSelectedLeadId(data.state.leads[0]?.id ?? "");
    }
    if (linkedLeadId || linkedView) window.history.replaceState({}, "", window.location.pathname);
    setAuthChecked(true);
    return true;
  }, [mode]);

  useEffect(() => {
    // Initial bootstrap is an external API synchronization, not derived client state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => setAuthChecked(true));
  }, [load]);

  const signedInUserId = bootstrap?.currentUser.id;

  useEffect(() => {
    if (!signedInUserId) return;
    const syncNotifications = async () => {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readApiJson<{ notifications: CrmNotification[] }>(response);
      setBootstrap((current) => current ? { ...current, notifications: data.notifications } : current);
    };
    const timer = window.setInterval(() => void syncNotifications(), 60_000);
    return () => window.clearInterval(timer);
  }, [signedInUserId]);

  useEffect(() => {
    if (!signedInUserId || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushSubscribed(Boolean(subscription)))
      .catch(() => setPushSubscribed(false));
  }, [signedInUserId]);

  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if ("serviceWorker" in navigator && "PushManager" in window) return;
    for (const notification of bootstrap?.notifications ?? []) {
      if (notification.readAt || browserNotifiedRef.current.has(notification.id)) continue;
      browserNotifiedRef.current.add(notification.id);
      new Notification(notification.title, { body: notification.body, tag: notification.eventKey });
    }
  }, [bootstrap?.notifications]);

  async function markNotification(notificationId?: string) {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notificationId ? { notificationId } : { all: true })
    });
    if (!response.ok) return;
    const data = await readApiJson<{ notifications: CrmNotification[] }>(response);
    setBootstrap((current) => current ? { ...current, notifications: data.notifications } : current);
  }

  async function enableBrowserNotifications() {
    if (!window.isSecureContext) {
      setToast("Push-уведомления доступны только по HTTPS. Откройте опубликованную версию CRM на Vercel.");
      return;
    }
    if (isIosDevice() && !isStandaloneApp()) {
      setToast("На iPhone сначала откройте CRM в Safari, нажмите «Поделиться» → «На экран Домой», затем запустите CRM с добавленной иконки.");
      return;
    }
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setToast("Этот браузер не поддерживает Web Push. Откройте CRM в актуальном Chrome, Edge, Firefox или Safari, а не во встроенном браузере мессенджера.");
      return;
    }
    if (Notification.permission === "denied") {
      setToast(deniedPushMessage());
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setToast(permission === "denied" ? deniedPushMessage() : "Разрешение не выдано. Нажмите кнопку ещё раз и выберите «Разрешить» в запросе браузера.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let configResponse = await fetch("/api/push/config", { cache: "no-store" });
      let config = await readApiJson<{ configured?: boolean; publicKey?: string; error?: string }>(configResponse);
      if (!config.configured) {
        configResponse = await fetch("/api/push/config", { method: "POST" });
        config = await readApiJson<typeof config>(configResponse);
      }
      if (!configResponse.ok || !config.publicKey) throw new Error(config.error || "Web Push ещё не настроен руководителем.");
      let existing = await registration.pushManager.getSubscription();
      if (existing && !subscriptionUsesKey(existing, config.publicKey)) {
        await fetch(`/api/push/subscriptions?endpoint=${encodeURIComponent(existing.endpoint)}`, { method: "DELETE" }).catch(() => null);
        await existing.unsubscribe();
        existing = null;
      }
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey)
      });
      const saveResponse = await fetch("/api/push/subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON())
      });
      const saved = await readApiJsonOrNull<{ error?: string }>(saveResponse);
      if (!saveResponse.ok) throw new Error(saved?.error || "Не удалось сохранить подписку устройства.");
      setPushSubscribed(true);
      setToast("Push-уведомления включены на этом устройстве.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось включить push-уведомления.");
    }
  }

  async function disableBrowserNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch(`/api/push/subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Не удалось удалить push-подписку на сервере.");
        await subscription.unsubscribe();
      }
      setPushSubscribed(false);
      setToast("Push-уведомления отключены на этом устройстве.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось отключить push-уведомления.");
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setNotificationsOpen(false);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        const data = await readApiJsonOrNull<{ error?: string }>(response);
        throw new Error(data?.error ?? "Не удалось завершить сессию.");
      }
      window.sessionStorage.removeItem("optiai:selectedLeadId");
      setBootstrap(null);
      setAuthChecked(true);
      window.location.replace("/");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось выйти из аккаунта.");
      setLoggingOut(false);
    }
  }

  async function runAction(action: CrmAction, message: string) {
    setLoadingAction(true);
    try {
      const response = await fetch("/api/crm/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action)
      });
      if (response.status === 401) {
        setBootstrap(null);
        setToast("Сессия закончилась. Войдите заново.");
        return false;
      }
      if (!response.ok) {
        const data = await readApiJsonOrNull<{ error?: string }>(response);
        setToast(data?.error || "Не удалось выполнить действие.");
        return false;
      }
      const data = await readApiJson<Bootstrap>(response);
      setBootstrap(data);
      if (action.type === "create_lead") {
        setQuery("");
        setTemperature("all");
        setActiveView("pipeline");
        setSelectedLeadId(data.state.leads[0]?.id ?? "");
      } else if (action.type === "delete_lead" && action.payload.leadId === selectedLeadId) {
        setSelectedLeadId("");
      } else if (selectedLeadId && !data.state.leads.some((lead) => lead.id === selectedLeadId)) {
        setSelectedLeadId("");
      }
      setToast(message);
      return true;
    } catch {
      setToast("Сервер недоступен. Изменения не сохранены.");
      return false;
    } finally {
      setLoadingAction(false);
    }
  }

  const state = bootstrap?.state;
  const metrics = bootstrap?.metrics;
  const currentUser = bootstrap?.currentUser;
  const allowedViews = (currentUser ? ROLE_PERMISSIONS[currentUser.role] : ROLE_PERMISSIONS["Руководитель"])
    .filter((view) => modeViews[mode].includes(view));
  const canCreateUsers = currentUser?.role === "Руководитель" || currentUser?.role === "РОП";
  const canCreateLeads = currentUser ? currentUser.role === "Руководитель" || currentUser.role === "РОП" || currentUser.role === "Менеджер" : false;
  const canDeleteLeads = currentUser?.role === "Руководитель" || currentUser?.role === "РОП";
  const unreadNotifications = (bootstrap?.notifications ?? []).filter((item) => !item.readAt);

  useEffect(() => {
    if (selectedLeadId) window.sessionStorage.setItem("optiai:selectedLeadId", selectedLeadId);
    else window.sessionStorage.removeItem("optiai:selectedLeadId");
  }, [selectedLeadId]);

  const selectedLead = useMemo(() => state?.leads.find((lead) => lead.id === selectedLeadId), [selectedLeadId, state?.leads]);

  const filteredLeads = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (state?.leads ?? []).filter((lead) => {
      const matchesTemperature = temperature === "all" || lead.temperature === temperature;
      const owner = (state?.users ?? []).find((user) => user.id === lead.ownerId);
      const haystack = [
        lead.companyName,
        lead.projectName,
        lead.optiaiLogin,
        lead.optiaiAccountId,
        lead.site,
        lead.contactName,
        lead.contactRole,
        lead.phone,
        lead.email,
        lead.telegram,
        lead.whatsapp,
        lead.sourceChannel,
        lead.sourceDetail,
        lead.industry,
        lead.region,
        lead.pain,
        lead.nextStep,
        owner?.fullName
      ].join(" ").toLowerCase();
      return matchesTemperature && (!value || haystack.includes(value));
    });
  }, [query, state?.leads, state?.users, temperature]);

  const searchResults = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return [];
    return (state?.leads ?? []).filter((lead) => {
      const owner = (state?.users ?? []).find((user) => user.id === lead.ownerId);
      const haystack = [
        lead.companyName,
        lead.projectName,
        lead.optiaiLogin,
        lead.optiaiAccountId,
        lead.site,
        lead.contactName,
        lead.contactRole,
        lead.phone,
        lead.email,
        lead.telegram,
        lead.whatsapp,
        lead.sourceChannel,
        lead.sourceDetail,
        lead.industry,
        lead.region,
        lead.pain,
        lead.nextStep,
        owner?.fullName
      ].join(" ").toLowerCase();
      return haystack.includes(value);
    }).slice(0, 8);
  }, [query, state?.leads, state?.users]);

  const managementClients = useMemo(() => {
    const subscriptions = state?.subscriptions ?? [];
    const payments = state?.payments ?? [];
    return filteredLeads
      .filter((lead) => subscriptions.some((item) => item.leadId === lead.id) || payments.some((item) => item.leadId === lead.id) || lead.stage === 4 || lead.stage === 5)
      .filter((lead) => {
        if (managementClientFilter === "all") return true;
        const active = subscriptions.some((item) => item.leadId === lead.id && item.status === "active");
        return managementClientFilter === "active" ? active : !active;
      })
      .sort((left, right) => {
        const leftSubscription = subscriptions.find((item) => item.leadId === left.id);
        const rightSubscription = subscriptions.find((item) => item.leadId === right.id);
        return (leftSubscription?.nextPaymentAt ?? "9999").localeCompare(rightSubscription?.nextPaymentAt ?? "9999");
      });
  }, [filteredLeads, managementClientFilter, state?.payments, state?.subscriptions]);

  if (!authChecked) {
    return (
      <main className="grid min-h-screen place-items-center text-neutral-900">
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-6 text-sm font-semibold text-slate-600">Загружаем OptiAI CRM...</div>
      </main>
    );
  }

  if (!bootstrap || !state || !metrics || !currentUser) {
    return <LoginScreen onLogin={load} />;
  }

  function openLead(lead: Lead, view: ViewId = mode === "leads" ? "pipeline" : "lead") {
    setSelectedLeadId(lead.id);
    setActiveView(view);
  }

  function viewLead(lead: Lead) {
    setSelectedLeadId(lead.id);
    setActiveView("lead");
  }

  function userName(userId: string) {
    return (bootstrap?.state.users ?? []).find((user) => user.id === userId)?.fullName ?? "Не назначен";
  }

  function tariffName(tariffId?: string) {
    const tariff = (bootstrap?.state.tariffs ?? []).find((item) => item.id === tariffId);
    return tariff ? tariff.price > 0 ? `${tariff.name} · ${money(tariff.price)}` : tariff.name : "тариф не выбран";
  }

  async function moveLeadToStage(lead: Lead, targetStage: number) {
    if (!bootstrap || loadingAction || targetStage === lead.stage || targetStage < 0 || targetStage >= STAGES.length || movingLeadIds.has(lead.id)) return false;
    const previous = bootstrap;
    setSelectedLeadId(lead.id);
    setMovingLeadIds((current) => new Set(current).add(lead.id));
    setBootstrap({
      ...bootstrap,
      state: {
        ...bootstrap.state,
        leads: bootstrap.state.leads.map((item) => item.id === lead.id ? { ...item, stage: targetStage, status: leadStatusForStage(targetStage) } : item)
      }
    });
    const ok = await runAction(
      { type: "move_stage", payload: { leadId: lead.id, stage: targetStage } },
      `${lead.companyName}: этап изменен на «${STAGES[targetStage]}».`
    );
    if (!ok) setBootstrap(previous);
    setMovingLeadIds((current) => {
      const next = new Set(current);
      next.delete(lead.id);
      return next;
    });
    return ok;
  }

  function renderPipelineActions(lead: Lead) {
    if (!state || !currentUser) return null;
    if (currentUser.role !== "Руководитель" && currentUser.role !== "РОП" && lead.ownerId !== currentUser.id) {
      return <span className="ui-badge">Просмотр · отвечает {userName(lead.ownerId)}</span>;
    }

    const openRefusal = () => {
      setSelectedLeadId(lead.id);
      setModal("refusal");
    };
    const subscription = state.subscriptions.find((item) => item.leadId === lead.id && item.status === "active");
    const primary = "ui-button ui-button-primary min-h-8 px-2.5 py-1 text-xs";
    const neutral = "ui-button ui-button-secondary min-h-8 px-2.5 py-1 text-xs";
    const warning = "ui-button ui-button-warning min-h-8 px-2.5 py-1 text-xs";
    const danger = "ui-button ui-button-danger min-h-8 px-2.5 py-1 text-xs";
    const success = "ui-button ui-button-success min-h-8 px-2.5 py-1 text-xs";

    if (lead.stage === 0) return (
      <>
        <a href={phoneHref(lead.phone)} onClick={() => { setSelectedLeadId(lead.id); setModal("callResult"); }} className={primary}><PhoneCall size={15} /> Позвонить</a>
        <button disabled={loadingAction} onClick={() => void moveLeadToStage(lead, 1)} className={warning}>В прогрев</button>
      </>
    );
    if (lead.stage === 1) return (
      <>
        <button disabled={loadingAction || !state.warmupSequences.some((sequence) => sequence.active)} onClick={() => { setSelectedLeadId(lead.id); setModal("assignWarmup"); }} className={neutral}>Назначить цепочку</button>
        <button disabled={loadingAction} onClick={() => void moveLeadToStage(lead, 2)} className={primary}>Планирует оплату</button>
        <button disabled={loadingAction} onClick={openRefusal} className={danger}>Отказ</button>
      </>
    );
    if (lead.stage === 2) return (
      <>
        <button disabled={loadingAction} onClick={() => void moveLeadToStage(lead, 3)} className={primary}>К оплате и подключению</button>
        <button disabled={loadingAction} onClick={openRefusal} className={danger}>Отказ</button>
      </>
    );
    if (lead.stage === 3) return (
      <div className="grid w-full gap-2">
        <div className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-2">
          {activationCheckLabels.map(([code, label]) => {
            const check = lead.activationChecks?.find((item) => item.code === code);
            return <div key={code} className="flex items-center gap-2 text-xs font-semibold text-slate-700"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={Boolean(check?.completedAt)} disabled={check?.notApplicable} onChange={(event) => void runAction({ type: "set_activation_check", payload: { leadId: lead.id, code, completed: event.target.checked, notApplicable: false, actorId: currentUser.id } }, `${label}: ${event.target.checked ? "выполнено" : "возвращено в работу"}.`)} /> <span>{label}</span></label><button type="button" onClick={() => void runAction({ type: "set_activation_check", payload: { leadId: lead.id, code, completed: false, notApplicable: !check?.notApplicable, actorId: currentUser.id } }, `${label}: статус обновлён.`)} className={clsx("rounded px-1.5 py-1 text-[10px]", check?.notApplicable ? "bg-slate-700 text-white" : "bg-white text-slate-500")}>Н/П</button>{check?.completedAt && <small className="text-slate-400">{dateLabel(check.completedAt)}</small>}</div>;
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={loadingAction || state.tariffs.length === 0} onClick={() => void runAction({ type: "mark_paid", payload: { leadId: lead.id, tariffId: lead.tariffId ?? state.tariffs[0]!.id } }, "Первая оплата зафиксирована.")} className={success}>Отметить оплату</button>
          <button disabled={loadingAction || activationCheckLabels.some(([code]) => { const check = lead.activationChecks?.find((item) => item.code === code); return !check?.completedAt && !check?.notApplicable; })} onClick={() => void moveLeadToStage(lead, 4)} className={primary}>Подключён</button>
          <button disabled={loadingAction} onClick={openRefusal} className={danger}>Отказ</button>
        </div>
      </div>
    );
    if (lead.stage === 5) return (
      <>
        <button disabled={loadingAction || !subscription} onClick={() => subscription && void runAction({ type: "renew_subscription", payload: { subscriptionId: subscription.id } }, "Подписка продлена, клиент возвращён в базу подключённых.")} className={success}>Продлить</button>
        <button disabled={loadingAction} onClick={openRefusal} className={danger}>Отказ</button>
      </>
    );
    return <span className="ui-badge">Этап завершён</span>;
  }

  const managementStart = (() => {
    const now = new Date();
    if (managementPeriod === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (managementPeriod === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (start.getDay() || 7) + 1);
    return start.getTime();
  })();
  const periodPayments = state?.payments.filter((payment) => payment.status === "paid" && Date.parse(`${payment.paidAt.slice(0, 10)}T00:00:00`) >= managementStart) ?? [];
  const firstPaymentByLead = new Map<string, string>();
  (state?.payments ?? []).filter((payment) => payment.status === "paid").forEach((payment) => { const previous = firstPaymentByLead.get(payment.leadId); if (!previous || payment.paidAt < previous) firstPaymentByLead.set(payment.leadId, payment.paidAt); });
  const activeSubscriptions = state?.subscriptions.filter((item) => item.status === "active") ?? [];
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).getTime();
  const potentialForecast = activeSubscriptions.filter((subscription) => { const due = Date.parse(subscription.nextPaymentAt); return due >= referenceNow && due <= monthEnd; }).reduce((sum, subscription) => sum + (state?.tariffs.find((tariff) => tariff.id === subscription.tariffId)?.price ?? 0), 0);
  const dashboardCards = [
    ["Активные клиенты", activeSubscriptions.length.toString(), "действующие оплаченные подписки"],
    ["Новые клиенты", [...firstPaymentByLead.values()].filter((date) => Date.parse(`${date.slice(0, 10)}T00:00:00`) >= managementStart).length.toString(), "первая оплата за период"],
    ["Потерянные клиенты", (state?.subscriptions.filter((item) => item.status === "cancelled").length ?? 0).toString(), "подписка завершена без продления"],
    ["Оплаты", periodPayments.length.toString(), `${money(periodPayments.reduce((sum, payment) => sum + payment.amount, 0))} за период`],
    ["Churn", `${metrics.churn}%`, "потерянные относительно клиентской базы"],
    ["LTV, ₽", money(metrics.ltv), "выручка / уникальные платившие клиенты"],
    ["LTV, мес.", `${metrics.averageLifetimeMonths} мес.`, "средняя длительность жизни клиента"],
    ["Потенциальный прогноз", money(potentialForecast), "ожидаемые продления до конца месяца"]
  ];
  const maxChannelLeads = Math.max(1, ...metrics.channels.map((channel) => channel.leads));
  const todayKey = new Date().toISOString().slice(0, 10);
  const visibleTasks = [...state.tasks]
    .filter((task) => task.status === taskFilter)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.title.localeCompare(b.title, "ru"));

  return (
    <div className="crm-shell">
      <aside className="crm-sidebar">
        <div className="mb-6 flex items-center gap-2 px-1 max-lg:justify-center">
          <Link href="/" className="crm-home-link" aria-label="К приложениям" title="К приложениям"><ArrowLeft size={17} /></Link>
          <div className="crm-brand-mark">OA</div>
          <div className="max-lg:hidden">
            <strong className="block text-sm">{modeTitle[mode]}</strong>
            <span className="text-xs text-slate-400">OptiAI Operations OS</span>
          </div>
        </div>

        <nav className="crm-nav" aria-label="Основная навигация">
          {navItems
            .filter((item) => allowedViews.includes(item.id))
            .map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setNotificationsOpen(false);
                  setActiveView(id);
                }}
                className={clsx("crm-nav-item", activeView === id && "crm-nav-item-active")}
                title={VIEW_TITLES[id]}
              >
                <Icon size={20} />
                <span className="max-lg:hidden">{VIEW_TITLES[id]}</span>
              </button>
            ))}
        </nav>

        <div className="crm-account-footer">
          <div className="max-lg:hidden">
            <span className="text-xs text-slate-400">Текущий аккаунт</span>
            <strong className="mt-1 block truncate text-sm text-white">{currentUser.fullName}</strong>
            <span className="block truncate text-xs text-slate-400">{currentUser.email}</span>
            <span className="mt-2 inline-flex rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-slate-200">{currentUser.role}</span>
            <p className="mt-3 text-xs leading-5 text-slate-400">{roleDescriptions[currentUser.role]}</p>
          </div>
          <button onClick={() => setModal("password")} className="crm-logout" aria-label="Сменить пароль">
            <KeyRound size={17} /> <span>Сменить пароль</span>
          </button>
          <button
            type="button"
            aria-label="Выйти из аккаунта"
            onClick={() => void logout()}
            disabled={loggingOut}
            className="crm-logout"
          >
            <LogOut size={17} /> <span>{loggingOut ? "Выходим..." : "Выйти"}</span>
          </button>
        </div>
      </aside>

      <main className="crm-main">
        <header className="crm-topbar mb-6 max-xl:items-start max-xl:flex-col">
          <div>
            <p className="text-xs font-semibold text-slate-500">{modeTitle[mode]} / {VIEW_TITLES[activeView]}</p>
            <h1 className="mt-1 text-2xl font-bold text-[#202939]">{VIEW_TITLES[activeView]}</h1>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-80 max-md:w-full">
              <div className="flex min-h-10 items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3 focus-within:border-[#536DFE] focus-within:ring-3 focus-within:ring-[#536DFE]/10">
              <Search size={17} className="text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && query.trim()) setActiveView(mode === "leads" ? "pipeline" : "lead");
                    if (event.key === "Escape") setQuery("");
                  }}
                  placeholder="Компания, контакт, телефон"
                  className="w-full bg-transparent outline-none"
                />
              </div>
              {query.trim() && (
                <div className="absolute right-0 top-12 z-40 w-[min(520px,calc(100vw-120px))] rounded-lg border border-[#E5E7EB] bg-white p-2 shadow-[var(--shadow-popover)]">
                  {searchResults.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Ничего не найдено</div>}
                  {searchResults.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => {
                        openLead(lead);
                        setQuery("");
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <strong className="block text-sm text-[#202939]">{lead.companyName}</strong>
                      <span className="block text-xs text-slate-600">{lead.contactName} · {lead.phone} · {STAGES[lead.stage]}</span>
                    </button>
                  ))}
                  {searchResults.length > 0 && (
                    <Link href={{ pathname: "/apps/leads", query: { view: "pipeline" } }} className="ui-button ui-button-secondary mt-1 w-full">Показать в воронке</Link>
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setNotificationsOpen((value) => !value)}
                className="ui-button ui-button-secondary ui-icon-button relative"
                aria-label="Уведомления"
                title="Уведомления"
              >
                <Bell size={19} />
                {unreadNotifications.length > 0 && (
                  <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                    {Math.min(99, unreadNotifications.length)}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-12 z-50 w-[min(390px,calc(100vw-32px))] rounded-lg border border-[#E5E7EB] bg-white p-2 shadow-[var(--shadow-popover)] max-md:fixed max-md:left-4 max-md:right-4 max-md:top-32 max-md:w-auto">
                  <div className="flex items-center justify-between gap-2 px-2 py-2">
                    <div>
                      <strong className="block text-sm text-[#202939]">Уведомления</strong>
                      <span className="text-xs text-slate-500">Непрочитанных: {unreadNotifications.length}</span>
                    </div>
                    {unreadNotifications.length > 0 && <button onClick={() => void markNotification()} className="text-xs font-semibold text-[#4357D9]">Прочитать все</button>}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {(bootstrap.notifications ?? []).length === 0 && <div className="px-2 py-5 text-center text-sm text-slate-500">Новых уведомлений нет</div>}
                    {(bootstrap.notifications ?? []).slice(0, 20).map((notification) => (
                      <button
                        key={notification.id}
                        onClick={() => {
                          void markNotification(notification.id);
                          setNotificationsOpen(false);
                          const lead = notification.leadId ? state.leads.find((item) => item.id === notification.leadId) : undefined;
                          if (lead) openLead(lead);
                          else setActiveView(notification.type === "message" ? "messengers" : "tasks");
                        }}
                        className={clsx("mb-1 block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50", !notification.readAt && "bg-[#F3F5FF]")}
                      >
                        <strong className="block text-sm text-[#202939]">{notification.title}</strong>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-600">{notification.body}</span>
                        <time className="mt-1 block text-[11px] text-slate-400">{new Date(notification.createdAt).toLocaleString("ru-RU")}</time>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => void (pushSubscribed ? disableBrowserNotifications() : enableBrowserNotifications())}
                    className="ui-button ui-button-secondary mt-2 w-full"
                  >
                    <Bell size={15} /> {pushSubscribed ? "Отключить push на этом устройстве" : "Включить фоновые push-уведомления"}
                  </button>
                </div>
              )}
            </div>
            {selectedLead && <button
              onClick={() => selectedLead && openLead(selectedLead)}
              className="ui-button ui-button-secondary ui-icon-button"
              aria-label="Открыть текущего лида в воронке"
              title="Открыть в воронке"
            >
              <PhoneCall size={19} />
            </button>}
            {mode === "leads" && canCreateLeads && <button onClick={() => setModal("newLead")} className="ui-button ui-button-primary">
              <Plus size={18} /> Новый лид
            </button>}
          </div>
        </header>

        {activeView === "dashboard" && (
          <section className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-lg font-bold text-[#202939]">Работа с продажами</h2><p className="mt-1 text-sm text-slate-600">Только лиды, состоявшиеся телефонные контакты и первые оплаченные сделки.</p></div>
              <div className="grid grid-cols-3 rounded-lg border border-[#E5E7EB] bg-white p-1">
                {(["today", "week", "month"] as const).map((period) => <button key={period} onClick={() => setSalesPeriod(period)} className={clsx("rounded-md px-3 py-2 text-xs font-semibold", salesPeriod === period ? "bg-[#EEF1FF] text-[#4357D9]" : "text-slate-600")}>{period === "today" ? "Сегодня" : period === "week" ? "Неделя" : "Месяц"}</button>)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              <article className="crm-kpi"><span className="text-xs font-semibold text-slate-500">Новые лиды</span><strong className="mt-2 block text-2xl font-bold tabular-nums">{bootstrap.salesMetrics[salesPeriod].leads}</strong><small className="mt-1 block text-xs text-slate-500">созданы за выбранный период</small></article>
              <article className="crm-kpi"><span className="text-xs font-semibold text-slate-500">Фактические контакты</span><strong className="mt-2 block text-2xl font-bold tabular-nums">{bootstrap.salesMetrics[salesPeriod].actualContacts}</strong><small className="mt-1 block text-xs text-slate-500">только состоявшиеся разговоры</small></article>
              <article className="crm-kpi"><span className="text-xs font-semibold text-slate-500">Первые оплаты</span><strong className="mt-2 block text-2xl font-bold tabular-nums">{bootstrap.salesMetrics[salesPeriod].firstPaidDeals}</strong><small className="mt-1 block text-xs text-slate-500">новые оплаченные сделки</small></article>
            </div>
            <Panel title="Мои задачи на сегодня" subtitle="Просроченные задачи и действия с дедлайном сегодня.">
              <div className="grid gap-2">
                {state.tasks.filter((task) => task.ownerId === currentUser.id && task.status === "open" && task.dueAt <= todayKey).length === 0 && <EmptyState title="На сегодня задач нет" text="Новые задачи появятся из воронки, прогревов и автоматизаций." />}
                {state.tasks.filter((task) => task.ownerId === currentUser.id && task.status === "open" && task.dueAt <= todayKey).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 8).map((task) => {
                  const lead = state.leads.find((item) => item.id === task.leadId);
                  return <button key={task.id} onClick={() => lead && openLead(lead)} className={clsx("rounded-lg border p-3 text-left", task.dueAt < todayKey ? "border-rose-300 bg-rose-50" : "border-[#E5E7EB] bg-[#F8FAFC]")}><strong className="block text-[#202939]">{task.title}</strong><span className="mt-1 block text-xs text-slate-600">{lead?.companyName ?? "Лид"} · {task.dueAt < todayKey ? "Просрочено" : "Сегодня"}</span></button>;
                })}
              </div>
            </Panel>
          </section>
        )}

        {activeView === "management" && (
          <section className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Состояние клиентской базы</h2><p className="mt-1 text-sm text-slate-600">Метрики рассчитаны только по фактическим данным CRM и OptiAI.</p></div><div className="grid grid-cols-3 rounded-lg border border-[#E5E7EB] bg-white p-1">{(["today", "week", "month"] as const).map((period) => <button key={period} onClick={() => setManagementPeriod(period)} className={clsx("rounded-md px-3 py-2 text-xs font-semibold", managementPeriod === period ? "bg-[#EEF1FF] text-[#4357D9]" : "text-slate-600")}>{period === "today" ? "Сегодня" : period === "week" ? "Неделя" : "Месяц"}</button>)}</div></div>
            <div className="grid grid-cols-4 gap-3 max-2xl:grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
              {dashboardCards.map(([label, value, hint]) => (
                <article key={label} className="crm-kpi">
                  <span className="text-xs font-semibold text-slate-500">{label}</span>
                  <strong className="mt-2 block text-2xl font-bold tabular-nums text-[#202939]">{value}</strong>
                  <small className="mt-1 block text-xs text-slate-500">{hint}</small>
                </article>
              ))}
            </div>

            <Panel title="Клиентская база" subtitle="Действующие и бывшие клиенты из общей базы OptiAI; поиск работает по компании, проекту, контактам и аккаунту.">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-[#E5E7EB] bg-white p-1">
                  {(["all", "active", "former"] as const).map((filter) => <button key={filter} type="button" onClick={() => setManagementClientFilter(filter)} className={clsx("rounded-md px-3 py-2 text-xs font-semibold", managementClientFilter === filter ? "bg-[#EEF1FF] text-[#4357D9]" : "text-slate-600")}>{filter === "all" ? "Все" : filter === "active" ? "Действующие" : "Бывшие"}</button>)}
                </div>
                <span className="text-xs text-slate-500">{managementClients.length} клиентов</span>
              </div>
              {managementClients.length === 0 ? <EmptyState title="Клиентов пока нет" text="Здесь появятся только клиенты с реальной оплатой, подпиской или подтверждённым подключением." /> : <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-xs text-slate-500"><tr><th className="pb-2">Компания / проект</th><th className="pb-2">Тариф</th><th className="pb-2">Статус</th><th className="pb-2">Первая оплата</th><th className="pb-2">Следующая оплата</th><th className="pb-2">Окончание</th><th className="pb-2">Ответственный</th><th className="pb-2 text-right">Действие</th></tr></thead>
                  <tbody>{managementClients.map((lead) => {
                    const subscription = state.subscriptions.find((item) => item.leadId === lead.id);
                    const firstPayment = state.payments.filter((item) => item.leadId === lead.id && item.status === "paid").sort((a, b) => a.paidAt.localeCompare(b.paidAt))[0];
                    const status = subscription?.status === "active" ? "Активен" : lead.stage === 5 ? "Не продлил" : "Бывший клиент";
                    return <tr key={lead.id} className="border-t border-slate-100"><td className="py-3"><strong className="block text-[#202939]">{lead.companyName}</strong><span className="text-xs text-slate-500">{lead.projectName || lead.site}</span></td><td className="py-3">{tariffName(subscription?.tariffId ?? lead.tariffId)}</td><td className="py-3"><Badge>{status}</Badge></td><td className="py-3">{dateLabel(firstPayment?.paidAt)}</td><td className="py-3">{dateLabel(subscription?.nextPaymentAt)}</td><td className="py-3">{dateLabel(subscription?.endsAt)}</td><td className="py-3">{userName(lead.ownerId)}</td><td className="py-3 text-right"><button type="button" onClick={() => openLead(lead, "lead")} className="ui-button ui-button-secondary">Открыть</button></td></tr>;
                  })}</tbody>
                </table>
              </div>}
            </Panel>

            <div className="grid grid-cols-[1.25fr_.75fr] gap-4 max-xl:grid-cols-1">
              <Panel title="Приоритеты на сегодня" subtitle="Просроченные и ближайшие задачи по реальным лидам.">
                <div className="grid gap-3">
                  {state.tasks.length === 0 && <EmptyState title="Задач пока нет" text="Создайте первого лида или импортируйте заявки, чтобы CRM начала формировать задачи." />}
                  {state.tasks
                    .filter((task) => task.status === "open")
                    .slice(0, 5)
                    .map((task) => {
                      const lead = state.leads.find((item) => item.id === task.leadId);
                      return (
                        <button key={task.id} onClick={() => lead && openLead(lead)} className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3 text-left transition-colors hover:border-[#AEB9FF]">
                          <strong className="block text-[#202939]">{task.title}</strong>
                          <span className="text-sm text-slate-600">{lead?.companyName} · {userName(task.ownerId)} · до {dateLabel(task.dueAt)}</span>
                        </button>
                      );
                    })}
                </div>
              </Panel>

              <Panel title="Каналы" subtitle="Фактические лиды, сделки и оплаченная выручка по источникам.">
                <div className="grid gap-2">
                  {metrics.channels.length === 0 && <EmptyState title="Источников пока нет" text="Статистика появится после создания первого реального лида." />}
                  {metrics.channels.map((channel) => (
                      <button key={channel.channel} onClick={() => { setQuery(channel.channel); setActiveView("pipeline"); }} className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-left transition-colors hover:border-[#AEB9FF]">
                        <div className="flex items-center justify-between">
                          <strong>{channel.channel}</strong>
                          <span className="text-sm text-slate-500">{channel.leads} лидов · {channel.conversion}%</span>
                        </div>
                        <span className="mt-1 block text-xs text-slate-500">{channel.deals} сделок · {money(channel.revenue)}</span>
                        <div className="mt-2 h-2 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-[#536DFE]" style={{ width: `${(channel.leads / maxChannelLeads) * 100}%` }} />
                        </div>
                      </button>
                    ))}
                </div>
              </Panel>
            </div>

            <div className="grid grid-cols-[1.1fr_.9fr] gap-4 max-xl:grid-cols-1">
              <Panel title="Конверсия воронки" subtitle="Доля лидов, которые действительно дошли до следующего этапа.">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[660px] text-left text-sm">
                    <thead className="text-xs text-slate-500"><tr><th className="pb-2">Переход</th><th className="pb-2">Вошли</th><th className="pb-2">Перешли</th><th className="pb-2 text-right">Конверсия</th></tr></thead>
                    <tbody>{metrics.stageConversions.map((item) => (
                      <tr key={`${item.from}-${item.to}`} className="border-t border-slate-100">
                        <td className="py-2 font-semibold text-[#202939]">{STAGES[item.from]} → {STAGES[item.to]}</td>
                        <td className="py-2 tabular-nums">{item.entered}</td><td className="py-2 tabular-nums">{item.advanced}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{item.conversion}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="Команда" subtitle="Результаты считаются по назначенным лидам и фактическим платежам.">
                <div className="grid gap-2">
                  {metrics.managers.map((manager) => {
                    const user = state.users.find((item) => item.id === manager.userId);
                    return <div key={manager.userId} className="border-b border-slate-100 py-2 last:border-0">
                      <div className="flex items-center justify-between gap-3"><strong className="text-sm">{user?.fullName ?? "Сотрудник"}</strong><span className="text-sm font-semibold tabular-nums">{money(manager.revenue)}</span></div>
                      <span className="mt-1 block text-xs text-slate-500">{manager.calls} звонков · {manager.meetings} встреч · {manager.deals} сделок · {manager.conversion}%</span>
                    </div>;
                  })}
                </div>
              </Panel>
            </div>
          </section>
        )}

        {activeView === "tasks" && (
          <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid w-full grid-cols-3 rounded-lg border border-[#E5E7EB] bg-white p-1 sm:inline-grid sm:w-auto">
                {(["open", "done", "cancelled"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setTaskFilter(status)}
                    className={clsx("min-w-0 rounded-md px-2 py-2 text-xs font-semibold sm:px-3 sm:text-sm", taskFilter === status ? "bg-[#EEF1FF] text-[#4357D9]" : "text-slate-600 hover:bg-slate-50")}
                  >
                    {status === "open" ? "В работе" : status === "done" ? "Выполнены" : "Отменены"}
                    <span className="ml-1 tabular-nums sm:ml-2">{state.tasks.filter((task) => task.status === status).length}</span>
                  </button>
                ))}
              </div>
              <span className="text-sm text-slate-600">Планировщик проверяет сроки ежедневно в 09:00 МСК.</span>
            </div>
            <Panel title="Задачи" subtitle="Перезвоны, ручные действия, прогревы и задачи автоматизаций.">
              <div className="grid gap-2">
                {visibleTasks.length === 0 && <EmptyState title="В этой группе задач нет" text="Новые задачи появятся после действий в воронке или запуска планировщика." />}
                {visibleTasks.map((task) => {
                  const lead = state.leads.find((item) => item.id === task.leadId);
                  const overdue = task.status === "open" && task.dueAt < todayKey;
                  const dueToday = task.status === "open" && task.dueAt === todayKey;
                  return (
                    <article key={task.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-[#E5E7EB] bg-white p-4 max-md:grid-cols-1">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-[#202939]">{task.title}</strong>
                          {overdue && <Badge>просрочено</Badge>}
                          {dueToday && <Badge>сегодня</Badge>}
                          {task.automationKey && <Badge>автоматически</Badge>}
                          <Badge>{task.taskType ?? "other"}</Badge>
                          {task.manualOverride && <Badge>ручное переопределение</Badge>}
                        </div>
                        {task.description && task.description !== task.title && <p className="mt-1 text-sm text-slate-600">{task.description}</p>}
                        <button onClick={() => lead && openLead(lead)} className="mt-1 block truncate text-left text-sm text-slate-600 hover:text-[#4357D9]">
                          {lead?.companyName ?? "Лид удалён"} · {userName(task.ownerId)}
                        </button>
                        <span className={clsx("mt-2 inline-flex items-center gap-1 text-xs font-semibold", overdue ? "text-rose-700" : "text-slate-500")}>
                          <Clock3 size={14} /> {dateLabel(task.dueAt)}
                        </span>
                        {task.result && <p className="mt-2 text-xs text-slate-600">Результат: {task.result}</p>}
                        {(task.history ?? []).length > 0 && <span className="ml-2 text-xs text-slate-400">История: {task.history!.length}</span>}
                      </div>
                      {task.status === "open" && (
                        <div className="flex flex-wrap gap-2 max-md:w-full">
                          <button disabled={loadingAction} onClick={() => void runAction({ type: "complete_task", payload: { taskId: task.id } }, "Задача выполнена.")} className="ui-button ui-button-success"><CheckCircle2 size={15} /> Выполнить</button>
                          <button disabled={loadingAction} onClick={() => { setSelectedTaskId(task.id); setModal("rescheduleTask"); }} className="ui-button ui-button-secondary"><CalendarClock size={15} /> Перенести</button>
                          <button disabled={loadingAction} onClick={() => void runAction({ type: "cancel_task", payload: { taskId: task.id } }, "Задача отменена.")} className="ui-button ui-button-danger"><X size={15} /> Отменить</button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </Panel>
          </section>
        )}

        {activeView === "pipeline" && (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-[#E5E7EB] bg-white p-1">
                {(["all", "hot", "warm", "cold"] as const).map((item) => (
                  <button key={item} onClick={() => setTemperature(item)} className={clsx("rounded-md px-3 py-2 text-sm font-semibold transition-colors", temperature === item ? "bg-[#EEF1FF] text-[#4357D9]" : "text-slate-600 hover:bg-slate-50")}>
                    {item === "all" ? "Все" : item === "hot" ? "Горячие" : item === "warm" ? "Теплые" : "Холодные"}
                  </button>
                ))}
              </div>
              <div className="text-right text-sm text-slate-600">
                <p>При “Не дозвонились” CRM автоматически ставит перезвоны 1/3/7 дней.</p>
                <p className="mt-1 text-xs">Этап “Подключён” закрывает активную сделку: клиент переходит в Панель управления.</p>
              </div>
            </div>
            <div className="crm-pipeline-layout">
              <div className="grid auto-cols-[300px] grid-flow-col gap-3 overflow-x-auto pb-3">
                {STAGES.map((stage, index) => ({ stage, index })).filter(({ index }) => index !== 4).map(({ stage, index }) => {
                  const stageLeads = filteredLeads.filter((lead) => lead.stage === index);
                  return (
                    <div
                      key={stage}
                      className={clsx("crm-pipeline-column", dropStage === index && draggingLeadId && "crm-pipeline-column-target")}
                      onDragEnter={(event) => {
                        if (!draggingLeadId) return;
                        event.preventDefault();
                        setDropStage(index);
                      }}
                      onDragOver={(event) => {
                        if (!draggingLeadId) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const lead = state.leads.find((item) => item.id === draggingLeadId);
                        setDropStage(null);
                        setDraggingLeadId("");
                        if (!lead || lead.stage === index) return;
                        setSelectedLeadId(lead.id);
                        if (index === 6) {
                          setModal("refusal");
                          return;
                        }
                        void moveLeadToStage(lead, index);
                      }}
                    >
                      <div className="mb-3 flex min-h-8 items-center justify-between gap-2 text-sm text-slate-500">
                        <strong className="text-[13px] font-semibold text-[#344054]">{stage}</strong>
                        <span className="grid size-6 place-items-center rounded-md bg-white text-xs font-semibold tabular-nums">{stageLeads.length}</span>
                      </div>
                      <div className="grid gap-3">
                        {stageLeads.map((lead) => {
                          const isSelected = selectedLeadId === lead.id;
                          const isMoving = movingLeadIds.has(lead.id);
                          const canManage = currentUser.role === "Руководитель" || currentUser.role === "РОП" || lead.ownerId === currentUser.id;
                          const leadTasks = state.tasks.filter((task) => task.leadId === lead.id && task.status === "open").sort((a, b) => a.dueAt.localeCompare(b.dueAt));
                          const isOverdue = leadTasks.some((task) => task.dueAt < todayKey);
                          const isDueToday = !isOverdue && leadTasks.some((task) => task.dueAt === todayKey);
                          return (
                            <article
                              key={lead.id}
                              draggable={!isMoving && canManage}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", lead.id);
                                suppressLeadClickRef.current = lead.id;
                                setDraggingLeadId(lead.id);
                                setSelectedLeadId(lead.id);
                              }}
                              onDragEnd={() => {
                                setDraggingLeadId("");
                                setDropStage(null);
                                window.setTimeout(() => {
                                  if (suppressLeadClickRef.current === lead.id) suppressLeadClickRef.current = "";
                                }, 200);
                              }}
                              className={clsx(
                                "crm-lead-card",
                                isSelected && "crm-lead-card-selected",
                                draggingLeadId === lead.id && "crm-lead-card-dragging",
                                isMoving && "crm-lead-card-saving",
                                isOverdue && "crm-lead-card-overdue",
                                isDueToday && "crm-lead-card-today"
                              )}
                            >
                              <button
                                onClick={() => {
                                  if (suppressLeadClickRef.current === lead.id) {
                                    suppressLeadClickRef.current = "";
                                    return;
                                  }
                                  setSelectedLeadId(lead.id);
                                }}
                                className="w-full text-left"
                              >
                                <span className="flex items-start justify-between gap-3">
                                  <span className="min-w-0">
                                    <strong className="block truncate text-[15px] font-bold text-[#202939]">{lead.companyName}</strong>
                                    <span className="mt-1 block truncate text-[13px] font-medium text-slate-700">{lead.contactName}</span>
                                  </span>
                                  {isSelected && <span className="crm-selected-indicator"><CheckCircle2 size={13} /> Выбран</span>}
                                </span>
                                <span className="mt-3 grid gap-1 text-xs leading-5 text-slate-600">
                                  <span className="truncate">{lead.phone}{lead.email && lead.email !== "уточнить" ? ` · ${lead.email}` : ""}</span>
                                  <span className="truncate">{userName(lead.ownerId)} · {lead.sourceChannel}</span>
                                  <span className="flex flex-wrap gap-1 pt-1">{lead.phone && <span className="ui-badge">Телефон</span>}{lead.telegram && <span className="ui-badge">Telegram</span>}{lead.whatsapp && <span className="ui-badge">WhatsApp</span>}{lead.max && <span className="ui-badge">MAX</span>}</span>
                                </span>
                              </button>
                              {leadTasks.length > 0 && <div className="crm-card-tasks"><strong>{isOverdue ? "Просрочено" : isDueToday ? "Сегодня" : "Ближайшие действия"}</strong>{leadTasks.slice(0, 3).map((task) => <span key={task.id}>{task.title} · {dateLabel(task.dueAt)}</span>)}{leadTasks.length > 3 && <small>Ещё {leadTasks.length - 3}</small>}</div>}
                              {lead.nextStep && <p className="crm-next-action"><span>Следующее действие</span>{lead.nextStep}</p>}
                              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                                <div className="flex items-center gap-1.5">
                                  <span className={clsx("size-2 rounded-full", lead.temperature === "hot" ? "bg-rose-500" : lead.temperature === "warm" ? "bg-amber-500" : "bg-slate-400")} />
                                  <span className="text-xs font-semibold text-slate-600">AI {lead.score}</span>
                                </div>
                                <div className="flex gap-1">
                                  {canManage && <button
                                    type="button"
                                    aria-label={`Редактировать ${lead.companyName}`}
                                    title="Редактировать"
                                    onClick={() => { setSelectedLeadId(lead.id); setModal("editLead"); }}
                                    className="ui-button ui-button-secondary ui-icon-button min-h-8 size-8"
                                  >
                                    <Pencil size={14} />
                                  </button>}
                                  <button type="button" onClick={() => viewLead(lead)} className="ui-button ui-button-secondary min-h-8 px-2.5 py-1 text-xs">Карточка</button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                        {stageLeads.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-center text-xs text-slate-500">Перетащите лида сюда</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <PipelineLeadDetail
                lead={selectedLead}
                userName={userName}
                onClear={() => setSelectedLeadId("")}
                onEdit={() => setModal("editLead")}
                onDelete={() => setModal("deleteLead")}
                canDelete={canDeleteLeads}
                onOpenCard={() => selectedLead && viewLead(selectedLead)}
              >
                {selectedLead ? renderPipelineActions(selectedLead) : null}
              </PipelineLeadDetail>
            </div>
          </section>
        )}

        {activeView === "messengers" && (
          <MessengerCenter
            state={state}
            currentUser={currentUser}
            onOpenLead={(leadId) => {
              setSelectedLeadId(leadId);
              setActiveView("pipeline");
            }}
            onCreateLead={() => setModal("newLead")}
          />
        )}

        {activeView === "lead" && selectedLead && (
          <LeadView
            lead={selectedLead}
            state={state}
            userName={userName}
            tariffName={tariffName}
            onOpenPipeline={() => openLead(selectedLead)}
            onUpdateOperations={(changes) => runAction({ type: "update_lead_operations", payload: { leadId: selectedLead.id, changes } }, "Данные проекта обновлены.")}
          />
        )}
        {activeView === "lead" && !selectedLead && (
          <EmptyState title="Карточек компаний пока нет" text="Добавьте первого лида через кнопку “Новый лид”. CRM не содержит демонстрационных компаний и ложных данных." action={<button onClick={() => setModal("newLead")} className="ui-button ui-button-primary">Создать лид</button>} />
        )}

        {activeView === "callcenter" && (
          <section className="grid grid-cols-[.8fr_1.2fr] gap-4 max-xl:grid-cols-1">
            <Panel title="Список обзвона" subtitle="Откройте телефон через tel:, затем зафиксируйте результат в воронке.">
              <div className="grid gap-3">
                {state.leads.filter((lead) => lead.status !== "lost").length === 0 && <EmptyState title="Список обзвона пуст" text="После создания лидов здесь появятся реальные звонки менеджеров." />}
                {state.leads.filter((lead) => lead.status !== "lost").map((lead) => (
                  <div key={lead.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
                    <button onClick={() => openLead(lead)} className="text-left">
                      <strong className="block">{lead.companyName}</strong>
                      <span className="text-sm text-slate-600">{lead.phone} · {lead.nextStep}</span>
                    </button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button onClick={() => openLead(lead)} className="ui-button ui-button-primary">В воронку</button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Расшифровки и AI-анализ" subtitle="До подключения телефонии расшифровку можно вставить вручную; позднее этот endpoint примет её автоматически.">
              <div className="grid gap-3">
                <AiCallAnalysisForm state={state} onSuccess={() => void load()} />
                {state.callRecords.length === 0 && <EmptyState title="Записей звонков пока нет" text="Здесь появятся реальные записи, расшифровки и AI-анализ после звонков." />}
                {state.callRecords.slice(0, 5).map((call) => {
                  const lead = state.leads.find((item) => item.id === call.leadId);
                  return (
                    <article key={call.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
                      <strong>{lead?.companyName}</strong>
                      <p className="mt-2 text-sm text-slate-700">{call.transcript}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm max-md:grid-cols-1">
                        <Badge>Интерес {call.interest}%</Badge>
                        <Badge>Вероятность {call.dealProbability}%</Badge>
                      </div>
                      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{call.summary}</p>
                    </article>
                  );
                })}
              </div>
            </Panel>
          </section>
        )}

        {activeView === "warmup" && (
          <section className="grid grid-cols-[1.2fr_.8fr] gap-4 max-xl:grid-cols-1">
            <Panel
              title="Цепочки прогрева"
              subtitle="Создавайте отдельные сценарии, редактируйте шаги и управляйте доступностью назначения."
              action={(currentUser.role === "Руководитель" || currentUser.role === "РОП") && (
                <button onClick={() => { setSelectedWarmupSequenceId(""); setSelectedWarmupStepId(""); setModal("warmupSequence"); }} className="ui-button ui-button-primary">
                  <Plus size={16} /> Новая цепочка
                </button>
              )}
            >
              <div className="grid gap-6">
                {state.warmupSequences.length === 0 && <EmptyState title="Цепочек пока нет" text="Создайте первый сценарий прогрева и добавьте в него касания по дням." />}
                {state.warmupSequences.map((sequence) => (
                  <section key={sequence.id} className="grid gap-3 border-b border-slate-200 pb-6 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3 max-md:flex-col">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>{sequence.name}</strong>
                          <Badge>{sequence.active ? "доступна" : "отключена"}</Badge>
                          <span className="text-xs font-semibold text-slate-500">{sequence.steps.length} шагов</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{sequence.description || "Описание не заполнено"}</p>
                      </div>
                      {(currentUser.role === "Руководитель" || currentUser.role === "РОП") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => { setSelectedWarmupSequenceId(sequence.id); setSelectedWarmupStepId(""); setModal("warmupStep"); }}
                            className="ui-button ui-button-primary"
                          ><Plus size={16} /> Добавить шаг</button>
                          <button
                            onClick={() => { setSelectedWarmupSequenceId(sequence.id); setModal("warmupSequence"); }}
                            className="ui-button ui-button-secondary ui-icon-button"
                            title="Изменить цепочку"
                            aria-label={`Изменить цепочку ${sequence.name}`}
                          ><Pencil size={16} /></button>
                          <button
                            disabled={loadingAction}
                            onClick={() => window.confirm(`Удалить цепочку «${sequence.name}» и её незавершённые задачи?`) && void runAction({ type: "delete_warmup_sequence", payload: { sequenceId: sequence.id } }, `Цепочка «${sequence.name}» удалена.`)}
                            className="ui-button ui-button-secondary ui-icon-button text-[#C43B4D]"
                            title="Удалить цепочку"
                            aria-label={`Удалить цепочку ${sequence.name}`}
                          ><Trash2 size={16} /></button>
                        </div>
                      )}
                    </div>
                    {sequence.steps.length === 0 && <EmptyState title="Шагов пока нет" text="Добавьте первое касание для этой цепочки." />}
                    {[...sequence.steps].sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, "ru")).map((step) => (
                      <div key={step.id} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3 max-md:grid-cols-1">
                        <span className="grid min-h-11 place-items-center rounded-lg bg-[#EEF1FF] font-semibold text-[#4357D9]">День {step.day}</span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2"><strong>{step.title}</strong><Badge>{step.contentType}</Badge></div>
                          <p className="mt-1 text-sm text-slate-600">{step.message}</p>
                          {step.attachmentUrl && <a href={step.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-[#4357D9]">
                            {step.attachmentType === "video" ? <Film size={16} /> : <ImageIcon size={16} />}
                            {step.attachmentName || (step.attachmentType === "video" ? "Видео" : "Изображение")}
                          </a>}
                        </div>
                        {(currentUser.role === "Руководитель" || currentUser.role === "РОП") && <div className="flex gap-2">
                          <button
                            onClick={() => { setSelectedWarmupSequenceId(sequence.id); setSelectedWarmupStepId(step.id); setModal("warmupStep"); }}
                            className="ui-button ui-button-secondary ui-icon-button"
                            title="Изменить шаг"
                            aria-label={`Изменить шаг ${step.title}`}
                          ><Pencil size={16} /></button>
                          <button
                            disabled={loadingAction}
                            onClick={() => window.confirm(`Удалить шаг «${step.title}»?`) && void runAction({ type: "delete_warmup_step", payload: { sequenceId: sequence.id, stepId: step.id } }, `Шаг «${step.title}» удалён.`)}
                            className="ui-button ui-button-secondary ui-icon-button text-[#C43B4D]"
                            title="Удалить шаг"
                            aria-label={`Удалить шаг ${step.title}`}
                          ><Trash2 size={16} /></button>
                        </div>}
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </Panel>

            <Panel title="Назначить прогрев" subtitle="Цепочка создаст задачи ответственному по дням.">
              <WarmupAssignmentForm
                state={state}
                submitting={loadingAction}
                onAssign={(leadId, sequenceId) => runAction({ type: "start_warmup", payload: { leadId, sequenceId } }, "Цепочка прогрева назначена лиду.")}
              />
            </Panel>
          </section>
        )}

        {activeView === "subscriptions" && (
          <Panel title="Подписки и продления" subtitle="Тариф, стоимость, старт, окончание, следующий платеж, история оплат.">
            <div className="grid gap-3">
              {state.subscriptions.length === 0 && <EmptyState title="Подписок пока нет" text="Когда клиент оплатит тариф, подписка появится здесь без фейковых оплат." />}
              {state.subscriptions.map((subscription) => {
                const lead = state.leads.find((item) => item.id === subscription.leadId);
                return (
                  <div key={subscription.id} className="grid grid-cols-[1.2fr_1fr_1fr_1fr_auto] items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3 max-xl:grid-cols-1">
                    <strong>{lead?.companyName}</strong>
                    <span>{tariffName(subscription.tariffId)}</span>
                    <span>Платеж: {dateLabel(subscription.nextPaymentAt)}</span>
                    <span>Договор до {dateLabel(subscription.endsAt)}</span>
                    <div className="flex flex-wrap gap-2"><button onClick={() => lead && openLead(lead)} className="ui-button ui-button-secondary">Карточка</button>{lead && <button onClick={() => void runAction({ type: "set_scripts_sent", payload: { leadId: lead.id, completed: !lead.scriptsSent, actorId: currentUser.id } }, lead.scriptsSent ? "Отметка снята." : "Отправка скриптов зафиксирована.")} className={clsx("ui-button", lead.scriptsSent ? "ui-button-success" : "ui-button-primary")}>{lead.scriptsSent ? "Скрипты отправлены" : "Отметить скрипты"}</button>}</div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {activeView === "team" && (
          <section className="grid gap-4">
            <div className="grid grid-cols-[1.2fr_.8fr] gap-4 max-xl:grid-cols-1">
              <Panel
                title="Аккаунты сотрудников"
                subtitle="Руководитель управляет всеми ролями. РОП может добавлять менеджеров и аккаунт-менеджеров."
                action={
                  canCreateUsers ? (
                    <button onClick={() => setModal("newUser")} className="ui-button ui-button-primary">Добавить сотрудника</button>
                  ) : (
                    <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Создает руководитель или РОП</span>
                  )
                }
              >
                <div className="grid gap-3">
                  {state.users.map((user) => {
                    const appAccess = appAccessFor(user);
                    return (
                    <article key={user.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
                      <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
                        <div className="flex items-center gap-3">
                          <div className="grid size-11 place-items-center rounded-lg bg-[#EEF1FF] font-bold text-[#4357D9]">{initials(user.fullName)}</div>
                          <div>
                            <strong className="block">{user.fullName}</strong>
                            <span className="text-sm text-slate-600">{user.position} · {user.email}</span>
                          </div>
                        </div>
                        <Badge>{user.role}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2 text-sm max-md:grid-cols-2">
                        <span className="rounded-md bg-slate-50 p-2">{metrics.managers.find((item) => item.userId === user.id)?.calls ?? 0} звонков</span>
                        <span className="rounded-md bg-slate-50 p-2">{user.meetings} встреч</span>
                        <span className="rounded-md bg-slate-50 p-2">{money(metrics.managers.find((item) => item.userId === user.id)?.revenue ?? 0)}</span>
                        <span className="rounded-md bg-slate-50 p-2">{metrics.managers.find((item) => item.userId === user.id)?.conversion ?? 0}% конверсия</span>
                      </div>
                      {currentUser.role === "Руководитель" && user.role !== "Руководитель" && (
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <span className="text-xs font-semibold text-slate-500">Доступ к приложениям</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {OS_APPS.map((app) => {
                              const active = appAccess.includes(app.id);
                              return <button key={app.id} type="button" onClick={() => void runAction({ type: "update_user_access", payload: { userId: user.id, appPermissions: (active ? appAccess.filter((id) => id !== app.id) : [...appAccess, app.id]) as OsAppId[], autoAssignEnabled: Boolean(user.autoAssignEnabled) } }, "Права сотрудника обновлены.")} className={clsx("ui-button min-h-8 px-2.5 py-1 text-xs", active ? "ui-button-primary" : "ui-button-secondary")}>{app.title}</button>;
                            })}
                          </div>
                          {(user.role === "Менеджер" || user.role === "РОП") && <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={Boolean(user.autoAssignEnabled)} onChange={(event) => void runAction({ type: "update_user_access", payload: { userId: user.id, appPermissions: appAccess, autoAssignEnabled: event.target.checked } }, "Настройка распределения обновлена.")} /> Участвует в автоматическом распределении лидов</label>}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-md bg-[#EEF1FF] px-3 py-2 text-sm font-semibold text-[#4357D9]">Supabase Auth · персональный пароль</span>
                        {currentUser.role === "Руководитель" && user.id === currentUser.id && (
                          <button onClick={() => setModal("ownerProfile")} className="ui-button ui-button-secondary">
                            <Pencil size={15} /> Изменить данные
                          </button>
                        )}
                        {currentUser.role === "Руководитель" && user.role !== "Руководитель" && (
                          <>
                            <button onClick={() => void runAction({ type: "disable_user", payload: { userId: user.id } }, "Аккаунт отключен, сделки переназначены.")} className="ui-button ui-button-secondary">Отключить</button>
                            <button onClick={() => window.confirm(`Удалить аккаунт ${user.fullName}? Это действие уберет пользователя из CRM.`) && void runAction({ type: "delete_user", payload: { userId: user.id } }, "Аккаунт удален из CRM.")} className="rounded-md bg-rose-100 px-3 py-2 text-sm font-bold text-rose-800">Удалить</button>
                          </>
                        )}
                      </div>
                    </article>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Права ролей" subtitle="Ролевые ограничения из ТЗ.">
                <div className="grid gap-3">
                  {(Object.keys(ROLE_PERMISSIONS) as Role[]).map((role) => (
                    <div key={role} className="rounded-lg border border-[#E5E7EB] bg-white p-3">
                      <strong>{role}</strong>
                      <p className="text-sm text-slate-600">{roleDescriptions[role]}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{ROLE_PERMISSIONS[role].map((view) => <Badge key={view}>{VIEW_TITLES[view]}</Badge>)}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <Panel title="Назначение сделок" subtitle="Руководитель и РОП управляют ответственными за лидов и клиентов.">
              <div className="grid gap-2">
                {state.leads.length === 0 && <EmptyState title="Назначать пока нечего" text="Сделки появятся после создания реальных лидов." />}
                {state.leads.map((lead) => (
                  <div key={lead.id} className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3 max-lg:grid-cols-1">
                    <strong>{lead.companyName}</strong>
                    <span>{STAGES[lead.stage]}</span>
                    <select value={lead.ownerId} onChange={(event) => void runAction({ type: "assign_lead", payload: { leadId: lead.id, ownerId: event.target.value } }, "Ответственный изменен.")} className="ui-field" aria-label={`Ответственный за ${lead.companyName}`}>
                      {state.users.filter((user) => user.status === "active").map((user) => <option key={user.id} value={user.id}>{user.fullName} · {user.role}</option>)}
                    </select>
                    <button onClick={() => openLead(lead)} className="ui-button ui-button-secondary">Открыть</button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Журнал безопасности" subtitle="Последние входы и административные действия без паролей и API-ключей.">
              <div className="grid gap-2">
                {(bootstrap.auditLog ?? []).length === 0 && <EmptyState title="Событий пока нет" text="Новые входы, аккаунты сотрудников и изменения интеграций появятся здесь." />}
                {(bootstrap.auditLog ?? []).map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-100 py-2 last:border-0 max-sm:grid-cols-1">
                    <div>
                      <strong className="block text-sm text-[#202939]">{auditActionLabels[entry.action] ?? entry.action}</strong>
                      <span className="text-xs text-slate-500">{entry.actorEmail} · {entry.actorRole}</span>
                    </div>
                    <time className="text-xs text-slate-500" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("ru-RU")}</time>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        )}

        {activeView === "automations" && (
          <section className="grid grid-cols-[.9fr_1.1fr] gap-4 max-xl:grid-cols-1">
            <Panel title="Автоматизации" subtitle="Правила выполняются планировщиком автоматически, без ручного запуска.">
              <div className="mb-3 rounded-lg border border-[#DCE2EA] bg-[#F8FAFC] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong className="block text-sm text-[#202939]">Vercel Cron · ежедневно 09:00 МСК</strong>
                    <span className="text-xs text-slate-600">
                      {bootstrap.automationStatus?.status === "completed" && bootstrap.automationStatus.finishedAt
                        ? `Последний запуск: ${new Date(bootstrap.automationStatus.finishedAt).toLocaleString("ru-RU")}`
                        : bootstrap.automationStatus?.status === "failed"
                          ? "Последний запуск завершился с ошибкой"
                          : bootstrap.automationStatus?.status === "running"
                            ? "Планировщик выполняется"
                            : "Первый запуск ещё не выполнялся"}
                    </span>
                  </div>
                  <Badge>{bootstrap.automationStatus?.status === "completed" ? "работает" : bootstrap.automationStatus?.status === "failed" ? "ошибка" : "ожидание"}</Badge>
                </div>
              </div>
              {[
                ["no_answer_3", "Нет ответа 3 дня", "Отправить сообщение"],
                ["no_answer_7", "Нет ответа 7 дней", "Создать задачу менеджеру"],
                ["no_answer_14", "Нет ответа 14 дней", "Запустить отдельный прогрев"],
                ["missed_call", "Не дозвонились", "Уведомить о перезвоне через 1, 3 и 7 дней"],
                ["renewal", "Продление", "Напомнить за 30, 14, 7 и 3 дня"]
              ].map(([key, title, detail]) => (
                <div key={key} className="mb-2 w-full rounded-lg border border-[#E5E7EB] bg-white p-3">
                  <strong>{title}</strong>
                  <span className="block text-sm text-slate-600">{detail}</span>
                </div>
              ))}
            </Panel>

            <Panel title="Интеграции" subtitle="Коммуникации, платежи, аналитика и телефония из ТЗ.">
              <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
                {state.integrations.map((integration) => (
                  <button
                    key={integration.id}
                    onClick={() => {
                      setSelectedIntegrationId(integration.id);
                      setModal("integration");
                    }}
                    className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-left transition-colors hover:border-[#AEB9FF]"
                  >
                    <strong className="block">{integration.name}</strong>
                    <span className="text-sm text-slate-600">{integration.description}</span>
                    <Badge>{integration.status === "connected" ? "подключено" : integration.status === "needs_setup" ? "настроить" : "ошибка"}</Badge>
                    <span className="mt-3 block rounded-md bg-[#EEF1FF] px-3 py-2 text-center text-sm font-semibold text-[#4357D9]">Настроить</span>
                  </button>
                ))}
              </div>
            </Panel>
          </section>
        )}
      </main>

      {modal && (
        <ModalShell onClose={() => {
          const refreshAfterClose = modal === "integration";
          setModal(null);
          if (refreshAfterClose) void load();
        }}>
          {modal === "newUser" && <NewUserForm currentUser={currentUser} submitting={loadingAction} onSubmit={async (action) => { const ok = await runAction(action, "Аккаунт сотрудника создан. Передайте ему email и временный пароль."); if (ok) setModal(null); }} />}
          {modal === "ownerProfile" && <OwnerProfileForm user={currentUser} submitting={loadingAction} onSubmit={async (action) => { const ok = await runAction(action, "Данные руководителя обновлены. Для следующего входа используйте новый email."); if (ok) setModal(null); }} />}
          {modal === "password" && <AccountPasswordForm onCancel={() => setModal(null)} onSuccess={() => { setBootstrap(null); setModal(null); }} />}
          {modal === "rescheduleTask" && state.tasks.find((task) => task.id === selectedTaskId) && (
            <RescheduleTaskForm
              task={state.tasks.find((task) => task.id === selectedTaskId)!}
              onCancel={() => setModal(null)}
              onSubmit={async (dueAt) => {
                const ok = await runAction({ type: "reschedule_task", payload: { taskId: selectedTaskId, dueAt } }, "Задача перенесена.");
                if (ok) setModal(null);
              }}
            />
          )}
          {modal === "callResult" && selectedLead && (
            <CallResultForm
              lead={selectedLead}
              ownerId={currentUser.id}
              submitting={loadingAction}
              onCancel={() => setModal(null)}
              onSubmit={async (action) => {
                const ok = await runAction(action, "Результат звонка сохранён.");
                if (ok) setModal(null);
                return ok;
              }}
            />
          )}
          {modal === "newLead" && <NewLeadForm state={state} currentUser={currentUser} onSubmit={async (action) => { const ok = await runAction(action, "Лид создан и задача поставлена."); if (ok) setModal(null); }} />}
          {modal === "editLead" && selectedLead && (
            <EditLeadForm
              lead={selectedLead}
              state={state}
              currentUser={currentUser}
              onCancel={() => setModal(null)}
              onSubmit={async (action) => {
                const ok = await runAction(action, "Изменения лида сохранены.");
                if (ok) setModal(null);
              }}
            />
          )}
          {modal === "deleteLead" && selectedLead && (
            <DeleteLeadConfirm
              lead={selectedLead}
              submitting={loadingAction}
              onCancel={() => setModal(null)}
              onConfirm={async () => {
                const ok = await runAction({ type: "delete_lead", payload: { leadId: selectedLead.id } }, `Лид «${selectedLead.companyName}» удален.`);
                if (ok) setModal(null);
              }}
            />
          )}
          {modal === "warmupSequence" && (
            <WarmupSequenceForm
              sequence={state.warmupSequences.find((sequence) => sequence.id === selectedWarmupSequenceId)}
              submitting={loadingAction}
              onSubmit={async (action) => {
                const ok = await runAction(action, action.type === "create_warmup_sequence" ? "Цепочка прогрева создана." : "Настройки цепочки сохранены.");
                if (ok) setModal(null);
              }}
            />
          )}
          {modal === "warmupStep" && (
            <WarmupForm
              sequenceId={selectedWarmupSequenceId}
              step={state.warmupSequences.find((sequence) => sequence.id === selectedWarmupSequenceId)?.steps.find((step) => step.id === selectedWarmupStepId)}
              onSubmit={async (action) => {
                const ok = await runAction(action, action.type === "create_warmup_step" ? "Шаг прогрева добавлен." : "Шаг прогрева сохранён.");
                if (ok) setModal(null);
                return ok;
              }}
            />
          )}
          {modal === "assignWarmup" && selectedLead && (
            <WarmupAssignmentForm
              state={state}
              initialLeadId={selectedLead.id}
              lockLead
              submitting={loadingAction}
              onAssign={async (leadId, sequenceId) => {
                const sequence = state.warmupSequences.find((item) => item.id === sequenceId);
                const ok = await runAction({ type: "start_warmup", payload: { leadId, sequenceId } }, `Прогрев «${sequence?.name ?? "сценарий"}» назначен лиду.`);
                if (ok) setModal(null);
                return ok;
              }}
            />
          )}
          {modal === "refusal" && selectedLead && <RefusalForm leadId={selectedLead.id} onSubmit={async (action) => { const ok = await runAction(action, "Отказ сохранен с причиной."); if (ok) setModal(null); }} />}
          {modal === "integration" && (
            <IntegrationForm
              integration={state.integrations.find((item) => item.id === selectedIntegrationId)}
              onSubmit={(action) => { setModal(null); void runAction(action, "Интеграция настроена."); }}
            />
          )}
        </ModalShell>
      )}

      {toast && <div className="crm-toast" role="status">{toast}</div>}
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => Promise<boolean> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      const data = await readApiJsonOrNull<{ error?: string }>(response);
      setError(data?.error || "Не удалось войти");
      setSubmitting(false);
      return;
    }
    await onLogin();
    setSubmitting(false);
  }

  async function requestReset() {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await readApiJsonOrNull<{ error?: string; message?: string }>(response);
      if (!response.ok) setError(data?.error ?? "Не удалось отправить письмо.");
      else setNotice(data?.message ?? "Проверьте почту и папку «Спам».");
    } catch {
      setError("Сервер недоступен. Попробуйте отправить ссылку позже.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#F5F7FA] p-4">
      <section className="grid w-[min(920px,100%)] grid-cols-[.85fr_1.15fr] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_12px_28px_rgb(16_24_40/0.10)] max-lg:grid-cols-1">
        <div className="flex min-h-[520px] flex-col bg-[#151A25] p-8 text-white max-lg:min-h-0">
          <div className="crm-brand-mark">OA</div>
          <div className="my-auto py-10">
            <h1 className="max-w-sm text-3xl font-bold leading-tight">Рабочее пространство OptiAI</h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">Продажи, задачи, звонки и подписки в одном защищенном интерфейсе.</p>
          </div>
          <p className="text-xs leading-5 text-slate-400">Доступ к аккаунтам выдает руководитель. Данные и разделы ограничены ролью сотрудника.</p>
        </div>

        <form onSubmit={resetMode ? (event) => { event.preventDefault(); void requestReset(); } : submit} className="grid content-center gap-5 p-10 max-md:p-6">
          <div>
            <h2 className="text-2xl font-bold text-[#202939]">{resetMode ? "Восстановление пароля" : "Вход в CRM"}</h2>
            <p className="mt-2 text-sm text-slate-600">{resetMode ? "Укажите рабочий email. Ссылка для нового пароля придет на почту." : "Введите рабочий email и пароль."}</p>
          </div>
          <label className="ui-label">
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required className="ui-field" />
          </label>
          {!resetMode && <label className="ui-label">
            Пароль
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required className="ui-field" />
          </label>}
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>}
          {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</div>}
          <button disabled={submitting} className="ui-button ui-button-primary w-full">
            {submitting ? (resetMode ? "Отправляем..." : "Входим...") : resetMode ? "Отправить ссылку" : "Войти"}
          </button>
          <button type="button" onClick={() => { setResetMode((value) => !value); setError(""); setNotice(""); }} className="text-sm font-semibold text-[#4357D9] hover:underline">
            {resetMode ? "Вернуться ко входу" : "Забыли пароль?"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="ui-panel">
      <div className="ui-panel-header max-md:flex-col">
        <div>
          <h2 className="text-base font-bold text-[#202939]">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="ui-panel-body">{children}</div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="ui-badge">{children}</span>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="ui-empty">
      <div>
      <strong className="block text-[#202939]">{title}</strong>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">{text}</p>
      {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

function PipelineLeadDetail({
  lead,
  userName,
  onClear,
  onEdit,
  onDelete,
  canDelete,
  onOpenCard,
  children
}: {
  lead?: Lead;
  userName: (id: string) => string;
  onClear: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
  onOpenCard: () => void;
  children: React.ReactNode;
}) {
  if (!lead) {
    return (
      <aside className="crm-lead-detail">
        <EmptyState title="Лид не выбран" text="Выберите карточку в воронке. Подробная информация останется здесь до выбора другого лида." />
      </aside>
    );
  }

  const hasEmail = lead.email && lead.email !== "уточнить";
  const hasSite = lead.site && lead.site !== "уточнить";
  const siteHref = hasSite ? (lead.site.startsWith("http") ? lead.site : `https://${lead.site}`) : "";

  return (
    <aside className="crm-lead-detail" aria-label={`Выбранный лид ${lead.companyName}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] pb-4">
        <div className="min-w-0">
          <span className="crm-selected-indicator"><CheckCircle2 size={13} /> Выбран</span>
          <h2 className="mt-2 truncate text-lg font-bold text-[#202939]">{lead.companyName}</h2>
          <p className="mt-1 text-sm font-medium text-slate-600">{STAGES[lead.stage]}</p>
        </div>
        <button type="button" onClick={onClear} aria-label="Снять выбор лида" title="Снять выбор" className="ui-button ui-button-secondary ui-icon-button min-h-9 size-9">
          <X size={16} />
        </button>
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-xs font-semibold text-slate-500">Контакт</dt>
          <dd className="mt-1 font-semibold text-[#202939]">{lead.contactName}{lead.contactRole ? ` · ${lead.contactRole}` : ""}</dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs font-semibold text-slate-500">Телефон</dt>
            <dd className="mt-1 break-words"><a className="font-semibold text-[#4357D9] hover:underline" href={phoneHref(lead.phone)}>{lead.phone}</a></dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">Email</dt>
            <dd className="mt-1 break-words">{hasEmail ? <a className="font-semibold text-[#4357D9] hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : "не указан"}</dd>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs font-semibold text-slate-500">Ответственный</dt>
            <dd className="mt-1 font-semibold text-[#202939]">{userName(lead.ownerId)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">Источник</dt>
            <dd className="mt-1 font-semibold text-[#202939]">{lead.sourceChannel}</dd>
          </div>
        </div>
        {hasSite && (
          <div>
            <dt className="text-xs font-semibold text-slate-500">Сайт</dt>
            <dd className="mt-1 break-words"><a href={siteHref} target="_blank" rel="noreferrer" className="font-semibold text-[#4357D9] hover:underline">{lead.site}</a></dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-semibold text-slate-500">Комментарий и контекст</dt>
          <dd className="mt-1 leading-5 text-slate-700">{lead.pain || "Комментарий не добавлен"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Следующий шаг</dt>
          <dd className="mt-1 leading-5 text-slate-700">{lead.nextStep || "Не назначен"}</dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-[#E5E7EB] pt-4">
        <p className="mb-2 text-xs font-semibold text-slate-500">Действия текущего этапа</p>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onEdit} className="ui-button ui-button-secondary"><Pencil size={15} /> Редактировать</button>
        <button type="button" onClick={onOpenCard} className="ui-button ui-button-secondary">Полная карточка</button>
      </div>
      {canDelete && <button type="button" onClick={onDelete} className="ui-button ui-button-danger mt-2 w-full"><Trash2 size={15} /> Удалить лида</button>}
    </aside>
  );
}

function LeadView({ lead, state, userName, tariffName, onOpenPipeline, onUpdateOperations }: { lead: Lead; state: CrmState; userName: (id: string) => string; tariffName: (id?: string) => string; onOpenPipeline: () => void; onUpdateOperations: (changes: Extract<CrmAction, { type: "update_lead_operations" }>["payload"]["changes"]) => void }) {
  const fields = [
    ["Компания", lead.companyName],
    ["Сайт", lead.site],
    ["Отрасль", lead.industry],
    ["Размер", lead.companySize],
    ["Регион", lead.region],
    ["Контакт", lead.contactName],
    ["Должность", lead.contactRole],
    ["Телефон", lead.phone],
    ["Email", lead.email],
    ["Telegram", lead.telegram],
    ["WhatsApp", lead.whatsapp],
    ["MAX", lead.max],
    ["Проект", lead.projectName || "не указан"],
    ["OptiAI Account ID", lead.optiaiAccountId || "не указан"],
    ["Логин OptiAI", lead.optiaiLogin || "не указан"],
    ["Предпочтительный канал", lead.preferredChannel || "не указан"],
    ["Есть SEO", lead.hasSeo === null ? "уточнить" : lead.hasSeo ? "да" : "нет"],
    ["Есть контекст", lead.hasContext === null ? "уточнить" : lead.hasContext ? "да" : "нет"],
    ["Маркетолог", lead.hasMarketer === null ? "уточнить" : lead.hasMarketer ? "да" : "нет"],
    ["Агентство", lead.hasAgency === null ? "уточнить" : lead.hasAgency ? "да" : "нет"],
    ["Брендовые запросы", lead.brandedQueries?.toLocaleString("ru-RU") ?? "уточнить"],
    ["Видимость в LLM", lead.llmVisibility === null ? "уточнить" : `${lead.llmVisibility}%`],
    ["GEO-потенциал", lead.geoPotential],
    ["Тариф", tariffName(lead.tariffId)]
  ];

  const activities = state.activities.filter((activity) => activity.leadId === lead.id).slice(0, 8);
  const documents = (state.clientDocuments ?? []).filter((document) => document.leadId === lead.id);

  return (
    <section className="grid gap-4">
      <div className="grid grid-cols-[1.1fr_.9fr] gap-4 max-xl:grid-cols-1">
        <Panel title={lead.companyName} subtitle={`${STAGES[lead.stage]} · ${userName(lead.ownerId)} · ${lead.sourceChannel}`}>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge>AI {lead.score}/100</Badge>
            <Badge>{lead.temperature === "hot" ? "Горячий" : lead.temperature === "warm" ? "Теплый" : "Холодный"}</Badge>
            <Badge>{lead.status}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {fields.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-[#F8FAFC] p-3">
                <span className="text-xs font-semibold text-slate-500">{label}</span>
                <strong className="mt-1 block break-words text-sm font-semibold text-[#202939]">{value}</strong>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-[#C7D0FF] bg-[#EEF1FF] p-3">
            <strong className="block text-[#3446B5]">Управление доступно в воронке</strong>
            <p className="mt-1 text-sm text-[#4453A4]">Звонки, недозвоны, прогрев, оплата и отказ выполняются на соответствующем этапе сделки.</p>
            <button onClick={onOpenPipeline} className="ui-button ui-button-primary mt-3">Открыть в воронке</button>
          </div>
        </Panel>

        <Panel title="AI-ассистент" subtitle="Автозаполнение после звонка, боли, summary, следующий шаг, контент.">
          <div className="grid gap-3">
            <Info title="Боль" text={lead.pain} />
            <Info title="Каналы продвижения" text={lead.currentPromotionChannels} />
            <Info title="Бюджет" text={lead.budget} />
            <Info title="Следующий шаг" text={lead.nextStep} />
            <Info title="Контент прогрева" text={lead.pain.includes("Директ") ? "Кейс по снижению стоимости лида после загрузки подтвержденных данных клиента." : "SEO + GEO аудит и карта конкурентов."} />
            {lead.refusalReason && <Info title="Причина отказа" text={lead.refusalReason} />}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-[1fr_.8fr] gap-4 max-xl:grid-cols-1">
        <Panel title="История коммуникаций" subtitle="Сообщения, звонки, задачи, оплаты и прогревы хранятся в CRM.">
          <div className="grid gap-2">
            {activities.map((activity) => (
              <div key={activity.id} className="grid grid-cols-[96px_1fr] gap-3 border-b border-[#E5E7EB] py-3 last:border-b-0 max-md:grid-cols-1">
                <span className="text-xs text-slate-500">{dateLabel(activity.createdAt)}</span>
                <div>
                  <strong className="text-sm text-[#202939]">{activity.title}</strong>
                  <p className="mt-1 text-sm text-slate-600">{activity.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Подписка" subtitle="Срок договора, платежи и уведомления 30/14/7/3 дня.">
          <div className="rounded-lg bg-[#202939] p-4 text-white">
            <strong>{tariffName(lead.tariffId)}</strong>
            <p className="mt-2 text-sm text-stone-300">Следующий шаг: {lead.nextStep}</p>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {["30", "14", "7", "3"].map((day) => (
              <span key={day} className="grid min-h-12 place-items-center rounded-lg bg-amber-100 font-black text-amber-900">{day} дн.</span>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Проект и аккаунт OptiAI" subtitle="Идентификаторы платформы и отдельные контакты мессенджеров используются для дедупликации и интеграций.">
        <form className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-md:grid-cols-1" onSubmit={(event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
          onUpdateOperations({ projectName: data.projectName.trim(), optiaiAccountId: data.optiaiAccountId.trim(), optiaiLogin: data.optiaiLogin.trim(), preferredChannel: data.preferredChannel as Lead["preferredChannel"], telegramId: data.telegramId.trim(), maxContact: data.maxContact.trim(), whatsappContact: data.whatsappContact.trim(), substatus: data.substatus ? data.substatus as Lead["substatus"] : null, expectedPaymentAt: data.expectedPaymentAt || null });
        }}>
          <FormInput name="projectName" label="Название проекта" defaultValue={lead.projectName ?? ""} />
          <FormInput name="optiaiAccountId" label="OptiAI Account ID" defaultValue={lead.optiaiAccountId ?? ""} />
          <FormInput name="optiaiLogin" label="Логин OptiAI" defaultValue={lead.optiaiLogin ?? ""} />
          <label className="ui-label">Предпочтительный канал<select name="preferredChannel" defaultValue={lead.preferredChannel ?? "phone"} className="ui-field"><option value="phone">Телефон</option><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option><option value="max">MAX</option><option value="email">Email</option></select></label>
          <FormInput name="telegramId" label="Telegram ID" defaultValue={lead.telegramId ?? ""} />
          <FormInput name="whatsappContact" label="WhatsApp" defaultValue={lead.whatsappContact ?? ""} />
          <FormInput name="maxContact" label="MAX" defaultValue={lead.maxContact ?? ""} />
          <label className="ui-label">Подстатус прогрева<select name="substatus" defaultValue={lead.substatus ?? ""} className="ui-field"><option value="">Нет</option><option>Не отвечает</option><option>Отложено</option></select></label>
          <FormInput name="expectedPaymentAt" label="Ожидаемая дата оплаты" type="date" defaultValue={lead.expectedPaymentAt ?? ""} />
          <div className="col-span-full"><button className="ui-button ui-button-primary">Сохранить данные проекта</button></div>
        </form>
        {(lead.sourceHistory ?? []).length > 0 && <div className="mt-4 border-t border-slate-100 pt-4"><strong className="text-sm">История источников</strong><div className="mt-2 flex flex-wrap gap-2">{lead.sourceHistory!.map((event) => <Badge key={event.id}>{event.source} · {event.eventType} · {dateLabel(event.occurredAt)}</Badge>)}</div></div>}
      </Panel>

      <Panel title="Счета и документы" subtitle="Документы не создаются отдельно от платформы: CRM показывает только синхронизированные сущности OptiAI.">
        {documents.length === 0 ? <EmptyState title="Синхронизированных документов нет" text="После подключения API OptiAI здесь появятся реальные счета, договоры и акты со статусами платформы." /> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-2">Документ</th><th className="pb-2">Тип</th><th className="pb-2">Статус</th><th className="pb-2">Сумма</th><th className="pb-2">Дата</th><th className="pb-2 text-right">Файл</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id} className="border-t border-slate-100"><td className="py-3 font-semibold text-[#202939]">{document.title}</td><td className="py-3">{document.kind === "invoice" ? "Счёт" : document.kind === "act" ? "Акт" : document.kind === "contract" ? "Договор" : "Документ"}</td><td className="py-3"><Badge>{document.status}</Badge></td><td className="py-3">{document.amount === undefined ? "—" : money(document.amount)}</td><td className="py-3">{dateLabel(document.createdAt)}</td><td className="py-3 text-right">{document.fileUrl ? <a href={document.fileUrl} target="_blank" rel="noreferrer" className="ui-button ui-button-secondary">Открыть</a> : <span className="text-xs text-slate-400">нет файла</span>}</td></tr>)}</tbody></table></div>}
      </Panel>
    </section>
  );
}

function Info({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-[#F8FAFC] p-3">
      <strong className="block text-sm text-[#202939]">{title}</strong>
      <span className="mt-1 block text-sm leading-5 text-slate-600">{text}</span>
    </div>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Закрыть" onClick={onClose} className="ui-modal-backdrop" />
      <section role="dialog" aria-modal="true" className="ui-modal">
        <button type="button" aria-label="Закрыть окно" title="Закрыть" onClick={onClose} className="ui-button ui-button-secondary ui-icon-button absolute right-4 top-4 min-h-9 size-9">
          <X size={17} />
        </button>
        {children}
      </section>
    </div>
  );
}

function AiCallAnalysisForm({ state, onSuccess }: { state: CrmState; onSuccess: () => void | Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/analyze-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: data.leadId, transcript: data.transcript, recordingUrl: data.recordingUrl })
      });
      const result = await readApiJson<{ analysis?: { summary?: string }; provider?: string; model?: string; error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "Не удалось выполнить AI-анализ.");
      setMessage(`Анализ сохранён${result.provider ? ` · ${result.provider}` : ""}${result.model ? ` · ${result.model}` : ""}.`);
      form.reset();
      await onSuccess();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить AI-анализ.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-3 grid gap-3 border-b border-slate-200 pb-4">
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <label className="ui-label">Лид<select name="leadId" className="ui-field" required>
          {state.leads.length === 0 && <option value="">Нет доступных лидов</option>}
          {state.leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.companyName} · {lead.contactName}</option>)}
        </select></label>
        <FormInput name="recordingUrl" label="Ссылка на запись (необязательно)" type="url" placeholder="https://..." />
      </div>
      <label className="ui-label">Расшифровка разговора<textarea name="transcript" minLength={30} maxLength={120000} rows={6} required className="ui-field resize-y" placeholder="Вставьте реальную расшифровку звонка" /></label>
      {message && <div role="status" className="rounded-lg border border-[#DCE2EA] bg-slate-50 p-3 text-sm text-slate-700">{message}</div>}
      <button disabled={submitting || state.leads.length === 0} className="ui-button ui-button-primary">{submitting ? "Анализируем..." : "Проанализировать разговор"}</button>
    </form>
  );
}

function CallResultForm({
  lead,
  ownerId,
  submitting,
  onSubmit,
  onCancel
}: {
  lead: Lead;
  ownerId: string;
  submitting: boolean;
  onSubmit: (action: CrmAction) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [result, setResult] = useState<ManualCallResult | null>(null);
  const [comment, setComment] = useState("");
  const options: { id: ManualCallResult; label: string; hint: string; icon: typeof PhoneCall }[] = [
    { id: "answered", label: "Дозвонился", hint: "Перевести к состоявшемуся разговору", icon: CheckCircle2 },
    { id: "no_answer", label: "Не дозвонился", hint: "Поставить перезвоны через 1/3/7 дней", icon: PhoneOff },
    { id: "busy", label: "Занято", hint: "Зафиксировать попытку и запланировать перезвон", icon: PhoneOff },
    { id: "invalid_number", label: "Неверный номер", hint: "Создать задачу на проверку контакта", icon: PhoneOff },
    { id: "other", label: "Другое", hint: "Зафиксировать иной исход звонка", icon: MessageSquareText },
    { id: "meeting", label: "Назначена встреча", hint: "Создать задачу на подготовку", icon: CalendarCheck2 },
    { id: "comment", label: "Только комментарий", hint: "Не менять этап и показатели", icon: MessageSquareText }
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result || (result === "comment" && !comment.trim())) return;
    await onSubmit({
      type: "record_call_result",
      payload: { leadId: lead.id, ownerId, result, comment: comment.trim() || undefined }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="pr-12">
        <h2 className="text-xl font-bold text-[#202939]">Результат звонка</h2>
        <p className="mt-2 text-sm text-slate-600">{lead.companyName} · {lead.contactName} · {lead.phone}</p>
      </div>

      <a href={phoneHref(lead.phone)} className="ui-button ui-button-primary w-fit"><PhoneCall size={16} /> Позвонить ещё раз</a>

      <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1" role="group" aria-label="Результат звонка">
        {options.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={result === id}
            onClick={() => setResult(id)}
            className={clsx(
              "flex min-h-20 items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              result === id ? "border-[#536DFE] bg-[#EEF1FF] text-[#3446B5]" : "border-[#D0D5DD] bg-white text-[#202939] hover:border-[#AEB9FF]"
            )}
          >
            <Icon size={19} className="mt-0.5 shrink-0" />
            <span>
              <strong className="block text-sm">{label}</strong>
              <span className="mt-1 block text-xs leading-5 text-slate-600">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      <label className="ui-label">
        Комментарий {result === "comment" ? "(обязательно)" : "(необязательно)"}
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Кратко зафиксируйте договорённости или причину недозвона"
          className="ui-field resize-y"
        />
      </label>

      <div className="flex justify-end gap-2 max-sm:flex-col-reverse">
        <button type="button" onClick={onCancel} disabled={submitting} className="ui-button ui-button-secondary">Отмена</button>
        <button type="submit" disabled={submitting || !result || (result === "comment" && !comment.trim())} className="ui-button ui-button-primary">
          {submitting ? "Сохраняем..." : "Сохранить результат"}
        </button>
      </div>
    </form>
  );
}

function RescheduleTaskForm({ task, onSubmit, onCancel }: {
  task: CrmState["tasks"][number];
  onSubmit: (dueAt: string) => Promise<void>;
  onCancel: () => void;
}) {
  const minimum = new Date().toISOString().slice(0, 10);
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void onSubmit(String(data.get("dueAt") ?? ""));
    }} className="grid gap-4">
      <div>
        <h2 className="pr-12 text-xl font-bold text-[#202939]">Перенести задачу</h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">{task.title}</p>
      </div>
      <label className="ui-label">Новая дата<input name="dueAt" type="date" min={minimum} defaultValue={task.dueAt < minimum ? minimum : task.dueAt} required className="ui-field" /></label>
      <div className="flex flex-wrap gap-2">
        <button className="ui-button ui-button-primary"><CalendarClock size={15} /> Перенести</button>
        <button type="button" onClick={onCancel} className="ui-button ui-button-secondary">Отмена</button>
      </div>
    </form>
  );
}

function NewUserForm({ currentUser, submitting, onSubmit }: { currentUser: CrmUser; submitting: boolean; onSubmit: (action: CrmAction) => void | Promise<void> }) {
  const [error, setError] = useState("");
  const allowedRoles: Role[] = currentUser.role === "Руководитель"
    ? ["Менеджер", "Аккаунт-менеджер", "Технический специалист", "РОП", "Руководитель"]
    : ["Менеджер", "Аккаунт-менеджер"];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    if (data.password !== data.passwordConfirmation) {
      setError("Пароли не совпадают.");
      return;
    }
    setError("");
    void onSubmit({ type: "create_user", payload: { fullName: data.fullName, email: data.email, role: data.role as Role, position: data.position, password: data.password } });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h2 className="pr-12 text-xl font-bold text-[#202939]">Добавить сотрудника</h2>
      <FormInput name="fullName" label="Имя и фамилия" required />
      <FormInput name="email" label="Email" type="email" required />
      <FormInput name="password" label="Временный пароль" type="password" minLength={10} autoComplete="new-password" required />
      <FormInput name="passwordConfirmation" label="Повторите пароль" type="password" minLength={10} autoComplete="new-password" required />
      <p className="text-sm leading-5 text-slate-600">Минимум 10 символов, включая буквы и цифры. Передайте пароль сотруднику безопасным способом: после входа он сможет заменить его через «Сменить пароль».</p>
      <label className="ui-label">
        Роль
        <select name="role" className="ui-field">
          {allowedRoles.map((role) => <option key={role}>{role}</option>)}
        </select>
      </label>
      <FormInput name="position" label="Должность" required />
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <button disabled={submitting} className="ui-button ui-button-primary">{submitting ? "Создаём..." : "Создать аккаунт"}</button>
    </form>
  );
}

function OwnerProfileForm({ user, submitting, onSubmit }: { user: CrmUser; submitting: boolean; onSubmit: (action: CrmAction) => void | Promise<void> }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    void onSubmit({
      type: "update_owner_profile",
      payload: {
        userId: user.id,
        fullName: data.fullName,
        email: data.email,
        position: data.position
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div>
        <h2 className="pr-12 text-xl font-bold text-[#202939]">Данные руководителя</h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">Email изменится одновременно в CRM и Supabase Auth. При следующем входе используйте новый адрес.</p>
      </div>
      <FormInput name="fullName" label="Имя и фамилия" defaultValue={user.fullName} autoComplete="name" required />
      <FormInput name="email" label="Рабочий email" type="email" defaultValue={user.email} autoComplete="email" required />
      <FormInput name="position" label="Должность" defaultValue={user.position} autoComplete="organization-title" required />
      <button disabled={submitting} className="ui-button ui-button-primary">{submitting ? "Сохраняем..." : "Сохранить изменения"}</button>
    </form>
  );
}

const integrationFieldMap: Record<string, { name: string; label: string; type?: string; placeholder?: string }[]> = {
  optiai: [
    { name: "apiUrl", label: "API URL", placeholder: "https://api.optiai.ru" },
    { name: "apiKey", label: "API Key", type: "password" },
    { name: "webhookSecret", label: "Webhook Secret", type: "password" }
  ],
  telegram: [
    { name: "botToken", label: "Bot Token", placeholder: "123456:ABC..." },
    { name: "webhookSecret", label: "Webhook Secret" }
  ],
  whatsapp: [
    { name: "provider", label: "Провайдер", placeholder: "360dialog / Wazzup / Green API" },
    { name: "apiKey", label: "API Key" },
    { name: "phoneId", label: "Phone ID / Instance ID" }
  ],
  max: [
    { name: "botToken", label: "Bot Token" },
    { name: "webhookSecret", label: "Webhook Secret" }
  ],
  instagram: [
    { name: "accessToken", label: "Access Token" },
    { name: "pageId", label: "Page / Business ID" }
  ],
  avito: [
    { name: "clientId", label: "Client ID" },
    { name: "clientSecret", label: "Client Secret" }
  ],
  sheets: [
    { name: "GOOGLE_SPREADSHEET_ID", label: "Spreadsheet ID" },
    { name: "GOOGLE_SHEET_RANGE", label: "Диапазон", placeholder: "CRM!A:V" },
    { name: "GOOGLE_SERVICE_ACCOUNT_JSON", label: "Service Account JSON", type: "password" }
  ],
  metrika: [
    { name: "YANDEX_METRIKA_COUNTER_ID", label: "Counter ID" },
    { name: "YANDEX_METRIKA_GOAL_ID", label: "Goal ID для оплаты" },
    { name: "YANDEX_METRIKA_OAUTH_TOKEN", label: "OAuth Token", type: "password" },
    { name: "YANDEX_METRIKA_USER_ID_SOURCE", label: "Источник UserId", placeholder: "lead_id / email / phone" }
  ],
  robokassa: [
    { name: "merchantLogin", label: "Merchant Login" },
    { name: "password1", label: "Password #1", type: "password" },
    { name: "password2", label: "Password #2", type: "password" }
  ],
  sip: [
    { name: "provider", label: "Провайдер", placeholder: "Zadarma / Mango / UIS" },
    { name: "apiKey", label: "API Key" },
    { name: "apiSecret", label: "API Secret", type: "password" },
    { name: "webhookSecret", label: "Webhook Secret" }
  ]
};

const messengerCredentialFields: Record<MessengerChannel, { name: string; label: string; type?: string; placeholder: string }[]> = {
  telegram: [
    { name: "TELEGRAM_BOT_TOKEN", label: "Bot Token", type: "password", placeholder: "Токен от @BotFather" },
    { name: "TELEGRAM_WEBHOOK_SECRET", label: "Webhook Secret", type: "password", placeholder: "Придумайте сложную секретную строку" }
  ],
  whatsapp: [
    { name: "WHATSAPP_ACCESS_TOKEN", label: "Access Token", type: "password", placeholder: "Постоянный токен Meta" },
    { name: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone Number ID", placeholder: "ID номера WhatsApp" },
    { name: "WHATSAPP_BUSINESS_ACCOUNT_ID", label: "Business Account ID", placeholder: "Необязательно" },
    { name: "WHATSAPP_VERIFY_TOKEN", label: "Verify Token", type: "password", placeholder: "Строка для проверки webhook" },
    { name: "WHATSAPP_APP_SECRET", label: "App Secret", type: "password", placeholder: "Секрет приложения Meta" },
    { name: "WHATSAPP_GRAPH_VERSION", label: "Graph API Version", placeholder: "Например, v24.0" },
    { name: "WHATSAPP_WARMUP_TEMPLATE_NAME", label: "Текстовый шаблон прогрева", placeholder: "Одобренный шаблон с одним параметром текста" },
    { name: "WHATSAPP_WARMUP_IMAGE_TEMPLATE_NAME", label: "Шаблон прогрева с фото", placeholder: "Шаблон с image header и параметром текста" },
    { name: "WHATSAPP_WARMUP_VIDEO_TEMPLATE_NAME", label: "Шаблон прогрева с видео", placeholder: "Шаблон с video header и параметром текста" },
    { name: "WHATSAPP_WARMUP_TEMPLATE_LANGUAGE", label: "Язык шаблона", placeholder: "Например, ru" }
  ],
  max: [
    { name: "MAX_BOT_TOKEN", label: "Bot Token", type: "password", placeholder: "Токен бота MAX" },
    { name: "MAX_WEBHOOK_SECRET", label: "Webhook Secret", type: "password", placeholder: "Секрет webhook" }
  ],
  instagram: [
    { name: "INSTAGRAM_ACCESS_TOKEN", label: "Access Token", type: "password", placeholder: "Токен Instagram Professional" },
    { name: "INSTAGRAM_ACCOUNT_ID", label: "Instagram Account ID", placeholder: "ID профессионального аккаунта" },
    { name: "INSTAGRAM_VERIFY_TOKEN", label: "Verify Token", type: "password", placeholder: "Придумайте строку для проверки webhook" },
    { name: "INSTAGRAM_APP_SECRET", label: "App Secret", type: "password", placeholder: "Секрет приложения Meta" },
    { name: "INSTAGRAM_GRAPH_VERSION", label: "Graph API Version", placeholder: "Например, v26.0" }
  ],
  avito: [
    { name: "AVITO_CLIENT_ID", label: "Client ID", placeholder: "Ключ приложения Avito" },
    { name: "AVITO_CLIENT_SECRET", label: "Client Secret", type: "password", placeholder: "Секрет приложения Avito" },
    { name: "AVITO_USER_ID", label: "User ID", placeholder: "Необязательно, определяется автоматически" },
    { name: "AVITO_WEBHOOK_SECRET", label: "Webhook Secret", type: "password", placeholder: "Придумайте сложную секретную строку" }
  ]
};

function AiIntegrationForm() {
  const [summary, setSummary] = useState<AiConfigurationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "check" | "delete" | "">("");
  const [message, setMessage] = useState("");

  const loadConfiguration = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ai/config", { cache: "no-store" });
      const data = await readApiJson<{ configuration?: AiConfigurationSummary; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось получить настройки AI.");
      setSummary(data.configuration ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось получить настройки AI.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The protected server response is the source of truth for masked AI settings.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConfiguration();
  }, [loadConfiguration]);

  async function request(method: "POST" | "DELETE") {
    setBusy(method === "POST" ? "check" : "delete");
    setMessage("");
    try {
      const response = await fetch("/api/ai/config", { method });
      const data = await readApiJson<{ configuration?: AiConfigurationSummary; message?: string; error?: string }>(response);
      if (data.configuration) setSummary(data.configuration);
      if (!response.ok) throw new Error(data.error || "Операция с AI не выполнена.");
      setMessage(data.message || "Операция выполнена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Операция с AI не выполнена.");
    } finally {
      setBusy("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const data = Object.fromEntries(formData.entries()) as Record<string, string>;
    try {
      const response = await fetch("/api/ai/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: data.provider,
          model: data.model,
          apiKey: data.apiKey,
          baseUrl: data.baseUrl,
          autoReplyEnabled: formData.get("autoReplyEnabled") === "on",
          warmupEnabled: formData.get("warmupEnabled") === "on",
          channels: formData.getAll("channels").map(String),
          companyContext: data.companyContext,
          replyInstructions: data.replyInstructions
        })
      });
      const result = await readApiJson<{ configuration?: AiConfigurationSummary; message?: string; error?: string }>(response);
      if (result.configuration) setSummary(result.configuration);
      if (!response.ok) throw new Error(result.error || "Не удалось подключить AI.");
      setMessage(result.message || "AI подключён.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось подключить AI.");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-500">Загружаем настройки AI...</div>;

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h2 className="pr-12 text-xl font-bold text-[#202939]">Настроить AI-ассистента</h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">Один защищённый ключ используется для анализа звонков, ответов клиентам и персонализации прогревов.</p>
      </div>
      <label className="ui-label">Провайдер<select name="provider" defaultValue={summary?.provider ?? "openai"} className="ui-field">
        <option value="openai">OpenAI</option><option value="anthropic">Claude / Anthropic</option><option value="gemini">Google Gemini</option>
      </select></label>
      <FormInput name="model" label="Модель" defaultValue={summary?.model ?? ""} placeholder="Точное название модели из кабинета провайдера" required />
      <FormInput name="apiKey" label="API-ключ" type="password" placeholder={summary?.hasApiKey ? "Оставьте пустым без изменений" : "Вставьте секретный API-ключ"} autoComplete="new-password" required={!summary?.hasApiKey} />
      <FormInput name="baseUrl" label="Base URL" defaultValue={summary?.baseUrl ?? ""} placeholder="Обычно менять не требуется" />
      <fieldset className="grid gap-3 rounded-lg border border-[#E5E7EB] p-3">
        <legend className="px-1 text-sm font-bold text-[#202939]">Автоматизация сообщений</legend>
        <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input name="autoReplyEnabled" type="checkbox" defaultChecked={summary?.autoReplyEnabled} className="size-4 accent-[#536DFE]" /> Автоматически отвечать на входящие сообщения</label>
        <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input name="warmupEnabled" type="checkbox" defaultChecked={summary?.warmupEnabled} className="size-4 accent-[#536DFE]" /> Персонализировать тексты прогрева через AI</label>
        <div><span className="ui-label">Каналы автопилота</span><div className="mt-2 flex flex-wrap gap-4">
          {([{"id":"telegram","label":"Telegram"},{"id":"whatsapp","label":"WhatsApp"},{"id":"max","label":"MAX"}] as const).map((channel) => <label key={channel.id} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input name="channels" value={channel.id} type="checkbox" defaultChecked={summary?.channels.includes(channel.id) ?? true} className="size-4 accent-[#536DFE]" />{channel.label}</label>)}
        </div></div>
      </fieldset>
      <label className="ui-label">Проверенные сведения о компании и услугах<textarea name="companyContext" defaultValue={summary?.companyContext ?? ""} rows={5} maxLength={6000} className="ui-field resize-y" placeholder="Что продаём, кому, преимущества, подтверждённые цены и ограничения" /></label>
      <label className="ui-label">Правила общения<textarea name="replyInstructions" defaultValue={summary?.replyInstructions ?? ""} rows={4} maxLength={4000} className="ui-field resize-y" placeholder="Тон, вопросы квалификации, когда передавать диалог менеджеру" /></label>
      {message && <div role="status" className="rounded-lg border border-[#DCE2EA] bg-slate-50 p-3 text-sm text-slate-700">{message}</div>}
      <div className="flex flex-wrap gap-2">
        <button disabled={Boolean(busy)} className="ui-button ui-button-primary">{busy === "save" ? "Проверяем..." : "Сохранить и проверить"}</button>
        <button type="button" disabled={Boolean(busy) || !summary?.configured} onClick={() => void request("POST")} className="ui-button ui-button-secondary">{busy === "check" ? "Проверяем..." : "Проверить подключение"}</button>
        <button type="button" disabled={Boolean(busy) || !summary?.hasApiKey} onClick={() => void request("DELETE")} className="ui-button ui-button-secondary text-[#C43B4D]">{busy === "delete" ? "Удаляем..." : "Удалить ключ"}</button>
      </div>
      <p className="text-xs leading-5 text-slate-500">AI отвечает только в выбранных каналах. Вложения, жалобы, договоры, платежи, индивидуальные цены и запрос человека автоматически передаются менеджеру. Ручной ответ ставит AI на паузу в этом диалоге.</p>
    </form>
  );
}

function IntegrationForm({ integration, onSubmit }: { integration?: CrmState["integrations"][number]; onSubmit: (action: CrmAction) => void }) {
  if (!integration) {
    return <EmptyState title="Интеграция не найдена" text="Закройте окно и выберите интеграцию заново." />;
  }

  const currentIntegration = integration;
  if (currentIntegration.id === "telegram" || currentIntegration.id === "whatsapp" || currentIntegration.id === "max" || currentIntegration.id === "instagram" || currentIntegration.id === "avito") {
    return <MessengerIntegrationForm channel={currentIntegration.id} />;
  }
  if (currentIntegration.id === "ai") return <AiIntegrationForm />;
  if (currentIntegration.id === "sheets" || currentIntegration.id === "metrika") return <ExternalIntegrationForm integration={currentIntegration} />;
  const fields = integrationFieldMap[currentIntegration.id] ?? [
    { name: "apiKey", label: "API Key" },
    { name: "webhookUrl", label: "Webhook URL" }
  ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    onSubmit({ type: "configure_integration", payload: { integrationId: currentIntegration.id, config: data } });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div>
        <h2 className="pr-12 text-xl font-bold text-[#202939]">Настроить {currentIntegration.name}</h2>
        <p className="mt-1 text-sm text-slate-600">{currentIntegration.description}</p>
      </div>
      {fields.map((field) => (
        <FormInput
          key={field.name}
          name={field.name}
          label={field.label}
          type={field.type ?? "text"}
          defaultValue={currentIntegration.config?.[field.name] ?? ""}
          placeholder={field.placeholder}
          required
        />
      ))}
      <button className="ui-button ui-button-primary">Сохранить интеграцию</button>
    </form>
  );
}

type ExternalIntegrationSummary = {
  id: "sheets" | "metrika";
  name: string;
  configured: boolean;
  configuredFields: Record<string, boolean>;
  lastRun?: { status?: string; started_at?: string; records_read?: number; records_written?: number; error?: string } | null;
};

function ExternalIntegrationForm({ integration }: { integration: CrmState["integrations"][number] }) {
  const id = integration.id as "sheets" | "metrika";
  const [summary, setSummary] = useState<ExternalIntegrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "check" | "sync" | "delete" | "">("");
  const [message, setMessage] = useState("");
  const fields = integrationFieldMap[id];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/integrations/${id}`, { cache: "no-store" });
      const data = await readApiJson<{ integration?: ExternalIntegrationSummary; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось получить состояние интеграции.");
      setSummary(data.integration ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось получить состояние интеграции.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // The form state is synchronized with the protected server-side integration store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function request(mode: "check" | "sync" | "delete") {
    setBusy(mode);
    setMessage("");
    try {
      const response = await fetch(`/api/integrations/${id}${mode === "delete" ? "" : `/${mode}`}`, { method: mode === "delete" ? "DELETE" : "POST" });
      const data = await readApiJson<{ integration?: ExternalIntegrationSummary; message?: string; error?: string }>(response);
      if (data.integration) setSummary(data.integration);
      if (!response.ok) throw new Error(data.error || "Операция не выполнена.");
      setMessage(data.message || "Операция выполнена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Операция не выполнена.");
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const config = Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value)]).filter(([, value]) => value.trim()));
    if (!Object.keys(config).length) { setMessage("Введите хотя бы одно новое значение."); return; }
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch(`/api/integrations/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
      const data = await readApiJson<{ integration?: ExternalIntegrationSummary; message?: string; error?: string }>(response);
      if (data.integration) setSummary(data.integration);
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки.");
      form.reset();
      setMessage(data.message || "Подключение проверено и сохранено.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки.");
    } finally {
      setBusy("");
    }
  }

  return <form onSubmit={save} className="grid gap-4">
    <div><h2 className="pr-12 text-xl font-bold text-[#202939]">{integration.name}</h2><p className="mt-1 text-sm text-slate-600">{integration.description}. Ключи шифруются и не возвращаются в браузер.</p></div>
    {loading ? <p className="text-sm text-slate-500">Проверяем состояние...</p> : <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      <div className="rounded-lg border border-[#E5E7EB] p-3"><span className="text-xs text-slate-500">Настройка</span><strong className="mt-1 block">{summary?.configured ? "Ключи сохранены" : "Не настроено"}</strong></div>
      <div className="rounded-lg border border-[#E5E7EB] p-3"><span className="text-xs text-slate-500">Последний обмен</span><strong className="mt-1 block">{summary?.lastRun?.started_at ? new Date(summary.lastRun.started_at).toLocaleString("ru-RU") : "Ещё не выполнялся"}</strong></div>
    </div>}
    <div className="grid gap-3">{fields.map((field) => <label key={field.name} className="ui-label">
      <span className="flex items-center justify-between gap-3"><span>{field.label}</span><span className={summary?.configuredFields[field.name] ? "text-xs font-semibold text-emerald-700" : "text-xs text-slate-400"}>{summary?.configuredFields[field.name] ? "Сохранено" : "Не задано"}</span></span>
      {field.name === "GOOGLE_SERVICE_ACCOUNT_JSON"
        ? <textarea name={field.name} rows={5} className="ui-field resize-y font-mono text-xs" placeholder={summary?.configuredFields[field.name] ? "Оставьте пустым без изменений" : "Вставьте содержимое JSON-файла сервисного аккаунта"} />
        : field.name === "YANDEX_METRIKA_USER_ID_SOURCE"
          ? <select name={field.name} className="ui-field" defaultValue="lead_id"><option value="lead_id">CRM ID лида</option><option value="email">Email</option><option value="phone">Телефон</option></select>
          : <input name={field.name} type={field.type ?? "text"} className="ui-field" placeholder={summary?.configuredFields[field.name] ? "Оставьте пустым без изменений" : field.placeholder} autoComplete="new-password" />}
    </label>)}</div>
    {summary?.lastRun?.error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{summary.lastRun.error}</div>}
    {message && <div className="rounded-lg border border-[#DCE2EA] bg-slate-50 p-3 text-sm text-slate-700">{message}</div>}
    <div className="flex flex-wrap gap-2">
      <button disabled={Boolean(busy)} className="ui-button ui-button-primary">{busy === "save" ? "Проверяем..." : "Сохранить и проверить"}</button>
      <button type="button" disabled={Boolean(busy) || !summary?.configured} onClick={() => void request("check")} className="ui-button ui-button-secondary">{busy === "check" ? "Проверяем..." : "Проверить"}</button>
      <button type="button" disabled={Boolean(busy) || !summary?.configured} onClick={() => void request("sync")} className="ui-button ui-button-primary">{busy === "sync" ? "Синхронизируем..." : "Синхронизировать"}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void request("delete")} className="ui-button ui-button-secondary">{busy === "delete" ? "Удаляем..." : "Удалить ключи"}</button>
    </div>
    <p className="text-xs leading-5 text-slate-500">{id === "sheets" ? "Используйте отдельный лист CRM. Таблица должна быть доступна email сервисного аккаунта с правом редактора." : "Для атрибуции на сайте должен передаваться тот же UserId, который выбран в настройке: lead_id, email или phone."}</p>
  </form>;
}

function MessengerIntegrationForm({ channel }: { channel: MessengerChannel }) {
  const [connection, setConnection] = useState<MessengerConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const loadConnection = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/messaging/connections", { cache: "no-store" });
      const data = await readApiJson<{ connections?: MessengerConnection[]; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось прочитать настройки.");
      setConnection(data.connections?.find((item) => item.channel === channel) ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось прочитать настройки.");
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    // Connection status is read from the protected server endpoint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConnection();
  }, [loadConnection]);

  async function check() {
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch(`/api/messaging/connections/${channel}/check`, { method: "POST" });
      const data = await readApiJson<{ connection?: MessengerConnection; message?: string; error?: string }>(response);
      if (data.connection) setConnection(data.connection);
      setMessage(data.message || data.error || (response.ok ? "Подключение работает." : "Проверка не пройдена."));
    } catch {
      setMessage("Сервер недоступен. Проверка не выполнена.");
    } finally {
      setChecking(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const config = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
    if (!Object.keys(config).length) {
      setMessage("Введите хотя бы одно новое значение. Пустые поля не изменяют сохранённые настройки.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/messaging/connections/${channel}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config })
      });
      const data = await readApiJson<{ connection?: MessengerConnection; message?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки.");
      if (data.connection) setConnection(data.connection);
      form.reset();
      setMessage(data.message || "Настройки сохранены. Теперь проверьте подключение.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  async function resetSavedSettings() {
    if (!window.confirm("Удалить сохранённые в CRM ключи этого канала? После этого будут использоваться переменные Vercel, если они заданы.")) return;
    setResetting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/messaging/connections/${channel}`, { method: "DELETE" });
      const data = await readApiJson<{ connection?: MessengerConnection; message?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось удалить настройки.");
      if (data.connection) setConnection(data.connection);
      setMessage(data.message || "Сохранённые настройки удалены.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить настройки.");
    } finally {
      setResetting(false);
    }
  }

  async function syncHistory() {
    setSyncing(true); setMessage("");
    try {
      const response = await fetch(`/api/messaging/connections/${channel}/sync`, { method: "POST" });
      const data = await readApiJson<{ read?: number; imported?: number; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось синхронизировать историю.");
      setMessage(`Прочитано сообщений: ${data.read ?? 0}. Добавлено новых: ${data.imported ?? 0}.`);
      await loadConnection();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось синхронизировать историю."); }
    finally { setSyncing(false); }
  }

  const statusLabel = connection?.status === "connected" ? "Подключён" : connection?.status === "error" ? "Ошибка" : connection?.status === "needs_setup" ? "Требует проверки" : "Не настроен";
  const webhookUrl = typeof window === "undefined" ? `/api/messaging/webhooks/${channel}` : `${window.location.origin}/api/messaging/webhooks/${channel}`;

  return (
    <form onSubmit={save} className="grid gap-4">
      <div>
        <h2 className="pr-12 text-xl font-bold text-[#202939]">{connection?.name ?? channel}</h2>
        <p className="mt-1 text-sm text-slate-600">Руководитель может менять ключи здесь без доступа к коду. Значения шифруются на сервере и никогда не возвращаются в браузер.</p>
      </div>
      {loading ? <p className="text-sm text-slate-500">Проверяем конфигурацию...</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <div className="rounded-lg border border-[#E5E7EB] p-3"><span className="text-xs text-slate-500">Состояние</span><strong className="mt-1 block">{statusLabel}</strong></div>
            <div className="rounded-lg border border-[#E5E7EB] p-3"><span className="text-xs text-slate-500">Webhook-защита</span><strong className="mt-1 block">{connection?.webhookConfigured ? "Настроена" : "Не настроена"}</strong></div>
            {connection?.externalAccountId && <div className="col-span-2 rounded-lg border border-[#E5E7EB] p-3 max-sm:col-span-1"><span className="text-xs text-slate-500">Подключённый аккаунт</span><strong className="mt-1 block">{connection.externalAccountUsername || connection.externalAccountId}</strong></div>}
          </div>
          <div className="grid gap-3">
            {messengerCredentialFields[channel].map((field) => {
              const configured = Boolean(connection?.configuredFields[field.name]);
              return (
                <label key={field.name} className="ui-label">
                  <span className="flex items-center justify-between gap-3">
                    <span>{field.label}</span>
                    <span className={configured ? "text-xs font-semibold text-emerald-700" : "text-xs font-semibold text-slate-400"}>{configured ? "Сохранено" : "Не задано"}</span>
                  </span>
                  <input
                    name={field.name}
                    type={field.type ?? "text"}
                    placeholder={configured ? "Оставьте пустым без изменений" : field.placeholder}
                    autoComplete="new-password"
                    className="ui-field"
                  />
                </label>
              );
            })}
          </div>
          <label className="ui-label">Webhook URL<input readOnly value={webhookUrl} className="ui-field bg-slate-50" /></label>
          {connection?.lastSyncAt && <p className="text-xs text-slate-500">Последняя успешная проверка: {new Date(connection.lastSyncAt).toLocaleString("ru-RU")}</p>}
          {connection?.lastError && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{connection.lastError}</div>}
        </>
      )}
      {message && <div className="rounded-lg border border-[#DCE2EA] bg-slate-50 p-3 text-sm text-slate-700">{message}</div>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving || resetting} className="ui-button ui-button-primary">{saving ? "Проверяем и подключаем..." : channel === "telegram" && connection?.externalAccountId ? "Заменить бота" : "Сохранить ключи"}</button>
        <button type="button" disabled={checking || !connection?.configured} onClick={() => void check()} className="ui-button ui-button-primary">{checking ? "Проверяем..." : "Проверить подключение"}</button>
        {channel === "avito" && <button type="button" disabled={syncing || !connection?.configured} onClick={() => void syncHistory()} className="ui-button ui-button-secondary">{syncing ? "Загружаем..." : "Загрузить историю"}</button>}
        <button type="button" disabled={resetting || saving} onClick={() => void resetSavedSettings()} className="ui-button ui-button-secondary">{resetting ? "Удаляем..." : "Удалить ключи CRM"}</button>
        <a href="/messengers-setup" target="_blank" rel="noreferrer" className="ui-button ui-button-secondary">Инструкция</a>
      </div>
      <p className="text-xs leading-5 text-slate-500">{channel === "telegram" ? "При замене CRM проверяет нового бота, переносит старые фото и видео в своё хранилище, обновляет webhook и сохраняет историю с назначениями. Клиенту нужно один раз нажать /start у нового бота." : "Пустое поле сохраняет прежнее значение. Переменные `.env.local` или Vercel используются как резерв, когда для канала нет соответствующего ключа в CRM."}</p>
    </form>
  );
}

function EditLeadForm({ lead, state, currentUser, onSubmit, onCancel }: {
  lead: Lead;
  state: CrmState;
  currentUser: CrmUser;
  onSubmit: (action: CrmAction) => void;
  onCancel: () => void;
}) {
  const canReassign = currentUser.role === "Руководитель" || currentUser.role === "РОП";
  const activeOwners = state.users.filter((user) => user.status === "active");
  const ownerOptions = canReassign ? activeOwners : activeOwners.filter((user) => user.id === currentUser.id);
  const channels = Array.from(new Set([lead.sourceChannel, "Cold Call", "Instagram", "Avito", "Telegram ads", "Яндекс директ", "Сайт"]));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    onSubmit({
      type: "update_lead",
      payload: {
        leadId: lead.id,
        changes: {
          companyName: data.companyName.trim(),
          site: data.site.trim() || "уточнить",
          industry: data.industry.trim() || "уточнить",
          companySize: data.companySize.trim() || "уточнить",
          region: data.region.trim() || "уточнить",
          contactName: data.contactName.trim(),
          contactRole: data.contactRole.trim() || "ЛПР",
          phone: data.phone.trim(),
          email: data.email.trim() || "уточнить",
          telegram: data.telegram.trim() || "уточнить",
          whatsapp: data.whatsapp.trim() || data.phone.trim(),
          max: data.max.trim() || "уточнить",
          hasSeo: data.hasSeo === "unknown" ? null : data.hasSeo === "yes",
          hasContext: data.hasContext === "unknown" ? null : data.hasContext === "yes",
          hasMarketer: data.hasMarketer === "unknown" ? null : data.hasMarketer === "yes",
          hasAgency: data.hasAgency === "unknown" ? null : data.hasAgency === "yes",
          brandedQueries: data.brandedQueries === "" ? null : Number(data.brandedQueries),
          llmVisibility: data.llmVisibility === "" ? null : Number(data.llmVisibility),
          geoPotential: data.geoPotential as Lead["geoPotential"],
          stage: Number(data.stage),
          sourceChannel: data.sourceChannel,
          sourceDetail: data.sourceDetail.trim() || "ручное создание",
          ownerId: data.ownerId || lead.ownerId,
          pain: data.pain.trim(),
          currentPromotionChannels: data.currentPromotionChannels.trim(),
          budget: data.budget.trim(),
          nextStep: data.nextStep.trim(),
          tariffId: data.tariffId || undefined,
          refusalReason: data.refusalReason.trim() || undefined
        }
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
      <div className="col-span-full pr-12">
        <h2 className="text-xl font-bold text-[#202939]">Редактировать лида</h2>
        <p className="mt-1 text-sm text-slate-600">Изменения сохраняются в общем хранилище CRM.</p>
      </div>
      <FormInput name="companyName" label="Компания" defaultValue={lead.companyName} required />
      <FormInput name="site" label="Сайт" defaultValue={lead.site} />
      <FormInput name="industry" label="Отрасль" defaultValue={lead.industry} />
      <FormInput name="companySize" label="Размер компании" defaultValue={lead.companySize} />
      <FormInput name="region" label="Регион" defaultValue={lead.region} />
      <FormInput name="contactName" label="Контактное лицо" defaultValue={lead.contactName} required />
      <FormInput name="contactRole" label="Должность" defaultValue={lead.contactRole} />
      <FormInput name="phone" label="Телефон" defaultValue={lead.phone} required />
      <FormInput name="email" label="Email" defaultValue={lead.email} />
      <FormInput name="telegram" label="Telegram" defaultValue={lead.telegram} />
      <FormInput name="whatsapp" label="WhatsApp" defaultValue={lead.whatsapp} />
      <FormInput name="max" label="MAX" defaultValue={lead.max} />
      <SelectBool name="hasSeo" label="Есть SEO" defaultValue={lead.hasSeo} />
      <SelectBool name="hasContext" label="Есть контекст" defaultValue={lead.hasContext} />
      <SelectBool name="hasMarketer" label="Есть маркетолог" defaultValue={lead.hasMarketer} />
      <SelectBool name="hasAgency" label="Есть агентство" defaultValue={lead.hasAgency} />
      <FormInput name="brandedQueries" label="Брендовые запросы" type="number" defaultValue={lead.brandedQueries?.toString() ?? ""} />
      <FormInput name="llmVisibility" label="Видимость в LLM, %" type="number" defaultValue={lead.llmVisibility?.toString() ?? ""} />
      <label className="ui-label">
        GEO-потенциал
        <select name="geoPotential" defaultValue={lead.geoPotential} className="ui-field">
          {["Новый", "Высокий", "Средний", "Низкий"].map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="ui-label">
        Этап воронки
        <select name="stage" defaultValue={lead.stage} className="ui-field">
          {STAGES.map((stage, index) => <option key={stage} value={index}>{stage}</option>)}
        </select>
      </label>
      <label className="ui-label">
        Источник
        <select name="sourceChannel" defaultValue={lead.sourceChannel} className="ui-field">
          {channels.map((channel) => <option key={channel}>{channel}</option>)}
        </select>
      </label>
      <FormInput name="sourceDetail" label="Детали источника" defaultValue={lead.sourceDetail} />
      <label className="ui-label">
        Ответственный
        <select name="ownerId" defaultValue={lead.ownerId} className="ui-field" disabled={!canReassign}>
          {ownerOptions.map((user) => <option key={user.id} value={user.id}>{user.fullName} · {user.role}</option>)}
        </select>
      </label>
      <label className="ui-label">
        Тариф
        <select name="tariffId" defaultValue={lead.tariffId ?? ""} className="ui-field">
          <option value="">Не выбран</option>
          {state.tariffs.map((tariff) => <option key={tariff.id} value={tariff.id}>{tariff.name} · {money(tariff.price)}</option>)}
        </select>
      </label>
      <FormTextarea name="pain" label="Комментарий / боль клиента" defaultValue={lead.pain} />
      <FormTextarea name="currentPromotionChannels" label="Текущие каналы продвижения" defaultValue={lead.currentPromotionChannels} />
      <FormInput name="budget" label="Бюджет" defaultValue={lead.budget} />
      <FormTextarea name="nextStep" label="Следующий шаг" defaultValue={lead.nextStep} />
      <FormInput name="refusalReason" label="Причина отказа" defaultValue={lead.refusalReason ?? ""} />
      <div className="col-span-full flex justify-end gap-2 max-md:flex-col-reverse">
        <button type="button" onClick={onCancel} className="ui-button ui-button-secondary">Отмена</button>
        <button className="ui-button ui-button-primary">Сохранить</button>
      </div>
    </form>
  );
}

function DeleteLeadConfirm({ lead, submitting, onConfirm, onCancel }: {
  lead: Lead;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="pr-12">
        <h2 className="text-xl font-bold text-[#202939]">Удалить лида?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Лид «{lead.companyName}» и связанные задачи, звонки, платежи и история будут удалены из хранилища CRM.</p>
      </div>
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">Это действие нельзя отменить.</div>
      <div className="flex justify-end gap-2 max-sm:flex-col-reverse">
        <button type="button" onClick={onCancel} disabled={submitting} className="ui-button ui-button-secondary">Отмена</button>
        <button type="button" onClick={onConfirm} disabled={submitting} className="ui-button ui-button-danger"><Trash2 size={15} /> {submitting ? "Удаляем..." : "Удалить лида"}</button>
      </div>
    </div>
  );
}

function NewLeadForm({ state, currentUser, onSubmit }: { state: CrmState; currentUser: CrmUser; onSubmit: (action: CrmAction) => void }) {
  const activeOwners = state.users.filter((user) => user.status === "active");
  const salesOwners = activeOwners.filter((user) => user.role === "Менеджер" || user.role === "Аккаунт-менеджер" || user.role === "РОП");
  const canReassign = currentUser.role === "Руководитель" || currentUser.role === "РОП";
  const availableOwners = salesOwners.length > 0 ? salesOwners : activeOwners.filter((user) => user.role === "Руководитель");
  const ownerOptions = canReassign ? availableOwners : activeOwners.filter((user) => user.id === currentUser.id);
  const fallbackOwnerId = ownerOptions[0]?.id ?? currentUser.id;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    onSubmit({
      type: "create_lead",
      payload: {
        companyName: data.companyName,
        site: data.site || "уточнить",
        industry: data.industry || "уточнить",
        companySize: data.companySize || "уточнить",
        region: data.region || "уточнить",
        contactName: data.contactName,
        contactRole: data.contactRole || "ЛПР",
        phone: data.phone,
        email: data.email || "уточнить",
        telegram: data.telegram || "уточнить",
        whatsapp: data.whatsapp || data.phone,
        max: data.max || "уточнить",
        hasSeo: data.hasSeo === "unknown" ? null : data.hasSeo === "yes",
        hasContext: data.hasContext === "unknown" ? null : data.hasContext === "yes",
        hasMarketer: data.hasMarketer === "unknown" ? null : data.hasMarketer === "yes",
        hasAgency: data.hasAgency === "unknown" ? null : data.hasAgency === "yes",
        brandedQueries: Number(data.brandedQueries || 0),
        llmVisibility: Number(data.llmVisibility || 0),
        geoPotential: "Новый",
        sourceChannel: data.sourceChannel,
        sourceDetail: data.sourceDetail || "ручное создание",
        ownerId: data.ownerId || fallbackOwnerId,
        pain: data.pain || "выявить боль",
        currentPromotionChannels: data.currentPromotionChannels || "уточнить",
        budget: data.budget || "уточнить",
        nextStep: "Найти контакт и сделать первый звонок",
        tariffId: data.tariffId
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
      <h2 className="col-span-full pr-12 text-xl font-bold text-[#202939]">Новый лид</h2>
      <FormInput name="companyName" label="Компания" required />
      <FormInput name="site" label="Сайт" />
      <FormInput name="industry" label="Отрасль" />
      <FormInput name="companySize" label="Размер компании" />
      <FormInput name="region" label="Регион" />
      <FormInput name="contactName" label="Контакт" required />
      <FormInput name="contactRole" label="Должность" />
      <FormInput name="phone" label="Телефон" required />
      <FormInput name="email" label="Email" />
      <FormInput name="telegram" label="Telegram" />
      <FormInput name="whatsapp" label="WhatsApp" />
      <FormInput name="max" label="MAX" />
      <SelectBool name="hasSeo" label="Есть SEO" />
      <SelectBool name="hasContext" label="Есть контекст" />
      <SelectBool name="hasMarketer" label="Есть маркетолог" />
      <SelectBool name="hasAgency" label="Есть агентство" />
      <FormInput name="brandedQueries" label="Брендовые запросы" type="number" />
      <FormInput name="llmVisibility" label="Видимость в LLM, %" type="number" />
      <FormInput name="pain" label="Боль клиента" />
      <FormInput name="currentPromotionChannels" label="Текущие каналы" />
      <FormInput name="budget" label="Бюджет" />
      <label className="ui-label">
        Канал
        <select name="sourceChannel" className="ui-field">
          {["Cold Call", "Instagram", "Avito", "Telegram ads", "Яндекс директ", "Сайт"].map((channel) => <option key={channel}>{channel}</option>)}
        </select>
      </label>
      <FormInput name="sourceDetail" label="Источник внутри канала" />
      <label className="ui-label">
        Ответственный
        <select name="ownerId" className="ui-field">
          {ownerOptions.map((user) => <option key={user.id} value={user.id}>{user.fullName} · {user.role}</option>)}
        </select>
        {salesOwners.length === 0 && <span className="text-xs font-medium text-amber-700">Пока нет менеджеров, лид будет назначен руководителю.</span>}
      </label>
      <label className="ui-label">
        Тариф
        <select name="tariffId" className="ui-field">
          {state.tariffs.map((tariff) => <option key={tariff.id} value={tariff.id}>{tariff.name} · {money(tariff.price)}</option>)}
        </select>
      </label>
      <button className="ui-button ui-button-primary col-span-full">Создать лид</button>
    </form>
  );
}

function WarmupSequenceForm({ sequence, submitting, onSubmit }: {
  sequence?: CrmState["warmupSequences"][number];
  submitting: boolean;
  onSubmit: (action: CrmAction) => void | Promise<void>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim(),
      active: data.get("active") === "on"
    };
    void onSubmit(sequence
      ? { type: "update_warmup_sequence", payload: { sequenceId: sequence.id, ...payload } }
      : { type: "create_warmup_sequence", payload });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h2 className="pr-12 text-xl font-bold text-[#202939]">{sequence ? "Изменить цепочку" : "Новая цепочка"}</h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">Отключённую цепочку нельзя назначать новым лидам, но уже отправленная история сохранится.</p>
      </div>
      <FormInput name="name" label="Название" defaultValue={sequence?.name ?? ""} required />
      <label className="ui-label">Описание<textarea name="description" defaultValue={sequence?.description ?? ""} rows={3} maxLength={1000} className="ui-field resize-y" /></label>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#344054]">
        <input name="active" type="checkbox" defaultChecked={sequence?.active ?? true} className="size-4 accent-[#536DFE]" />
        Доступна для назначения
      </label>
      <button disabled={submitting} className="ui-button ui-button-primary">{submitting ? "Сохраняем..." : sequence ? "Сохранить" : "Создать цепочку"}</button>
    </form>
  );
}

function WarmupAssignmentForm({ state, submitting, onAssign, initialLeadId, lockLead = false }: { state: CrmState; submitting: boolean; onAssign: (leadId: string, sequenceId: string) => Promise<boolean>; initialLeadId?: string; lockLead?: boolean }) {
  const activeSequences = state.warmupSequences.filter((sequence) => sequence.active);
  const [leadId, setLeadId] = useState(initialLeadId ?? state.leads[0]?.id ?? "");
  const [sequenceId, setSequenceId] = useState(activeSequences[0]?.id ?? "");
  const currentLeadId = state.leads.some((lead) => lead.id === leadId) ? leadId : state.leads[0]?.id ?? "";
  const currentSequenceId = activeSequences.some((sequence) => sequence.id === sequenceId) ? sequenceId : activeSequences[0]?.id ?? "";

  return <form onSubmit={(event) => { event.preventDefault(); if (currentLeadId && currentSequenceId) void onAssign(currentLeadId, currentSequenceId); }} className="grid gap-3">
    {lockLead && <div><h2 className="pr-12 text-xl font-bold text-[#202939]">Выбрать цепочку прогрева</h2><p className="mt-1 text-sm text-slate-600">Назначение создаст задачи по дням и запустит автоматическую отправку.</p></div>}
    <label className="ui-label">Лид<select value={currentLeadId} onChange={(event) => setLeadId(event.target.value)} className="ui-field" required disabled={lockLead}>
      {state.leads.length === 0 && <option value="">Нет доступных лидов</option>}
      {state.leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.companyName} · {lead.contactName}</option>)}
    </select></label>
    <label className="ui-label">Цепочка<select value={currentSequenceId} onChange={(event) => setSequenceId(event.target.value)} className="ui-field" required>
      {activeSequences.length === 0 && <option value="">Нет включённых цепочек</option>}
      {activeSequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name} · {sequence.steps.length} шагов</option>)}
    </select></label>
    <button disabled={submitting || !currentLeadId || !currentSequenceId} className="ui-button ui-button-primary">{submitting ? "Назначаем..." : "Назначить цепочку"}</button>
  </form>;
}

function WarmupForm({ sequenceId, step, onSubmit }: { sequenceId?: string; step?: CrmState["warmupSequences"][number]["steps"][number]; onSubmit: (action: CrmAction) => Promise<boolean> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries()) as Record<string, string | File>;
    if (!sequenceId) return;
    setSubmitting(true);
    setError("");
    try {
      const file = data.attachment instanceof File && data.attachment.size > 0 ? data.attachment : null;
      const uploaded = file ? await uploadMediaFile(file) : null;
      const removeAttachment = data.removeAttachment === "on";
      const common = {
        sequenceId,
        day: Number(data.day),
        title: String(data.title),
        message: String(data.message),
        contentType: String(data.contentType) as CrmState["warmupSequences"][number]["steps"][number]["contentType"]
      };
      await onSubmit(step ? {
        type: "update_warmup_step",
        payload: {
          ...common,
          stepId: step.id,
          attachmentUrl: uploaded?.url ?? (removeAttachment ? null : step.attachmentUrl),
          attachmentType: uploaded?.type ?? (removeAttachment ? null : step.attachmentType),
          attachmentName: uploaded?.name ?? (removeAttachment ? null : step.attachmentName)
        }
      } : {
        type: "create_warmup_step",
        payload: { ...common, attachmentUrl: uploaded?.url, attachmentType: uploaded?.type, attachmentName: uploaded?.name }
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Не удалось сохранить вложение.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h2 className="pr-12 text-xl font-bold text-[#202939]">{step ? "Изменить шаг прогрева" : "Новый шаг прогрева"}</h2>
      <FormInput name="day" label="День" type="number" min={0} max={3650} defaultValue={step?.day.toString() ?? ""} required />
      <FormInput name="title" label="Название" defaultValue={step?.title ?? ""} required />
      <label className="ui-label">Тип контента<select name="contentType" defaultValue={step?.contentType ?? "Custom"} className="ui-field">
        <option value="VSL">VSL</option><option value="SEO audit">SEO audit</option><option value="Case">Кейс</option><option value="Competitor audit">Аудит конкурентов</option><option value="Custom">Другое</option>
      </select></label>
      <label className="ui-label">Сообщение или цель<textarea name="message" defaultValue={step?.message ?? ""} rows={5} maxLength={4000} required className="ui-field resize-y" /></label>
      <label className="ui-label">Фото или видео<input name="attachment" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" className="ui-field file:mr-3 file:border-0 file:bg-transparent file:font-semibold" /></label>
      {step?.attachmentUrl && <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input name="removeAttachment" type="checkbox" className="size-4 accent-[#536DFE]" /> Удалить текущее вложение</label>}
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      <button disabled={submitting} className="ui-button ui-button-primary">{submitting ? "Сохраняем..." : step ? "Сохранить шаг" : "Добавить шаг"}</button>
    </form>
  );
}

function RefusalForm({ leadId, onSubmit }: { leadId: string; onSubmit: (action: CrmAction) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    onSubmit({ type: "mark_refused", payload: { leadId, reason: data.reason } });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h2 className="pr-12 text-xl font-bold text-[#202939]">Причина отказа</h2>
      <label className="ui-label">
        Причина
        <select name="reason" className="ui-field">
          <option>Не готов к бюджету</option>
          <option>Нет срочности</option>
          <option>Уже есть агентство</option>
          <option>Нет доверия к SEO</option>
          <option>Вернуться через 3 месяца</option>
        </select>
      </label>
      <button className="ui-button bg-[#C43B4D] text-white hover:bg-[#A92F40]">Сохранить отказ</button>
    </form>
  );
}

function FormInput({ name, label, type = "text", required = false, defaultValue = "", placeholder, minLength, min, max, autoComplete }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string; minLength?: number; min?: number; max?: number; autoComplete?: string }) {
  return (
    <label className="ui-label">
      {label}
      <input name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} minLength={minLength} min={min} max={max} autoComplete={autoComplete} className="ui-field" />
    </label>
  );
}

function FormTextarea({ name, label, defaultValue = "" }: { name: string; label: string; defaultValue?: string }) {
  return (
    <label className="ui-label">
      {label}
      <textarea name={name} defaultValue={defaultValue} rows={3} className="ui-field min-h-24 resize-y" />
    </label>
  );
}

function SelectBool({ name, label, defaultValue = null }: { name: string; label: string; defaultValue?: boolean | null }) {
  return (
    <label className="ui-label">
      {label}
      <select name={name} defaultValue={defaultValue === null ? "unknown" : defaultValue ? "yes" : "no"} className="ui-field">
        <option value="unknown">Уточнить</option>
        <option value="yes">Да</option>
        <option value="no">Нет</option>
      </select>
    </label>
  );
}
