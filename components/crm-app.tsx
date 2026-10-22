"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Flame,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  PhoneCall,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
  X
} from "lucide-react";
import { ROLE_PERMISSIONS, STAGES, VIEW_TITLES, type CrmAction, type CrmState, type CrmUser, type Lead, type Role, type ViewId } from "@/lib/crm/types";

type Metrics = {
  leads: number;
  calls: number;
  deals: number;
  payments: number;
  mrr: number;
  churn: number;
  ltv: number;
  conversion: number;
};

type Bootstrap = {
  currentUser: CrmUser;
  state: CrmState;
  metrics: Metrics;
};

type Modal = "newUser" | "newLead" | "warmupStep" | "refusal" | "integration" | null;

const navItems: { id: ViewId; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", icon: LayoutDashboard },
  { id: "pipeline", icon: BriefcaseBusiness },
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
  Менеджер: "Видит только свои сделки, звонки, задачи и прогревы.",
  "Аккаунт-менеджер": "Видит действующих клиентов, продления и удержание."
};

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

export function CrmApp() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [selectedLeadId, setSelectedLeadId] = useState("l-nord");
  const [query, setQuery] = useState("");
  const [temperature, setTemperature] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [toast, setToast] = useState("");
  const [loadingAction, setLoadingAction] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const response = await fetch("/api/crm/bootstrap", { cache: "no-store" });
    if (response.status === 401) {
      setBootstrap(null);
      setAuthChecked(true);
      return false;
    }
    const data = (await response.json()) as Bootstrap;
    setBootstrap(data);
    if (!data.state.leads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(data.state.leads[0]?.id ?? "");
    }
    setAuthChecked(true);
    return true;
  }

  async function runAction(action: CrmAction, message: string) {
    setLoadingAction(true);
    const response = await fetch("/api/crm/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action)
    });
    if (response.status === 401) {
      setBootstrap(null);
      setToast("Сессия закончилась. Войдите заново.");
      setLoadingAction(false);
      return false;
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setToast(data?.error || "Не удалось выполнить действие.");
      setLoadingAction(false);
      return false;
    }
    const data = (await response.json()) as Bootstrap;
    setBootstrap(data);
    if (action.type === "create_lead") {
      setQuery("");
      setTemperature("all");
      setActiveView("pipeline");
      setSelectedLeadId(data.state.leads[0]?.id ?? "");
    } else if (!data.state.leads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(data.state.leads[0]?.id ?? "");
    }
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
    setLoadingAction(false);
    return true;
  }

  const state = bootstrap?.state;
  const metrics = bootstrap?.metrics;
  const currentUser = bootstrap?.currentUser;
  const allowedViews = currentUser ? ROLE_PERMISSIONS[currentUser.role] : ROLE_PERMISSIONS["Руководитель"];
  const canCreateUsers = currentUser?.role === "Руководитель" || currentUser?.role === "РОП";

  useEffect(() => {
    if (!allowedViews.includes(activeView)) setActiveView(allowedViews[0]);
  }, [activeView, allowedViews]);

  const selectedLead = useMemo(() => state?.leads.find((lead) => lead.id === selectedLeadId) ?? state?.leads[0], [selectedLeadId, state?.leads]);

  const filteredLeads = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (state?.leads ?? []).filter((lead) => {
      const matchesTemperature = temperature === "all" || lead.temperature === temperature;
      const owner = (state?.users ?? []).find((user) => user.id === lead.ownerId);
      const haystack = [
        lead.companyName,
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

  function openLead(lead: Lead, view: ViewId = "pipeline") {
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
    return tariff ? `${tariff.name} · ${money(tariff.price)}` : "тариф не выбран";
  }

  function renderPipelineActions(lead: Lead) {
    if (!state || !currentUser) return null;

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

    if (lead.stage === 0) {
      return <button disabled={loadingAction} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: 1 } }, `${lead.companyName}: контакт найден.`)} className={primary}>Контакт найден</button>;
    }

    if (lead.stage === 1) {
      return <button disabled={loadingAction} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: 2 } }, `${lead.companyName}: назначен первый звонок.`)} className={primary}>Первый звонок</button>;
    }

    if (lead.stage === 2 || lead.stage === 3) {
      return (
        <>
          <a href={phoneHref(lead.phone)} onClick={() => void runAction({ type: "record_call", payload: { leadId: lead.id, ownerId: currentUser.id } }, "Звонок открыт на устройстве, CRM зафиксировала разговор.")} className={primary}>Звонок</a>
          <button disabled={loadingAction} onClick={() => void runAction({ type: "mark_no_answer", payload: { leadId: lead.id, ownerId: lead.ownerId } }, "Недозвон зафиксирован: задачи на 1, 3 и 7 дней поставлены.")} className={warning}>Не дозвон</button>
        </>
      );
    }

    if (lead.stage === 4) {
      return <button disabled={loadingAction} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: 5 } }, `${lead.companyName}: аудит отправлен.`)} className={primary}>Отправить аудит</button>;
    }

    if (lead.stage === 5) {
      return <button disabled={loadingAction} onClick={() => void runAction({ type: "start_warmup", payload: { leadId: lead.id, sequenceId: state.warmupSequences[0]?.id ?? "" } }, "Прогрев запущен по сценарию OptiAI.")} className={warning}>Запустить прогрев</button>;
    }

    if (lead.stage === 6) {
      return (
        <>
          <button disabled={loadingAction} onClick={() => void runAction({ type: "send_message", payload: { leadId: lead.id, channel: "Telegram", text: "Отправлено касание прогрева по текущему сценарию." } }, "Касание прогрева отправлено.")} className={neutral}>Касание</button>
          <button disabled={loadingAction} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: 7 } }, `${lead.companyName}: перешел к решению.`)} className={primary}>Сделка/отказ</button>
        </>
      );
    }

    if (lead.stage === 7) {
      return (
        <>
          <button disabled={loadingAction} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: 8 } }, `${lead.companyName}: перешел к оплате.`)} className={primary}>Следующий</button>
          <button disabled={loadingAction} onClick={openRefusal} className={danger}>Отказ</button>
        </>
      );
    }

    if (lead.stage === 8) {
      return <button disabled={loadingAction} onClick={() => void runAction({ type: "mark_paid", payload: { leadId: lead.id, tariffId: lead.tariffId ?? state.tariffs[0].id } }, "Оплата отмечена, клиент подключен.")} className={success}>Отметить оплату</button>;
    }

    if (lead.stage === 9) {
      return <button disabled={loadingAction} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: 10 } }, `${lead.companyName}: поставлен на продление.`)} className={primary}>К продлению</button>;
    }

    if (lead.stage === 10) {
      return (
        <>
          <button disabled={loadingAction || !subscription} onClick={() => subscription && void runAction({ type: "renew_subscription", payload: { subscriptionId: subscription.id } }, "Продление запущено.")} className={warning}>Продлить</button>
          <button disabled={loadingAction} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: 11 } }, `${lead.companyName}: переведен в апселл.`)} className={primary}>Апселл</button>
        </>
      );
    }

    if (lead.stage === 11) {
      return (
        <>
          <button disabled={loadingAction} onClick={() => void runAction({ type: "mark_paid", payload: { leadId: lead.id, tariffId: lead.tariffId ?? state.tariffs[0].id } }, "Оплата апселла отмечена.")} className={success}>Оплата</button>
          <button disabled={loadingAction} onClick={openRefusal} className={danger}>Отказ</button>
        </>
      );
    }

    return <span className="ui-badge">Завершено</span>;
  }

  const dashboardCards = [
    ["Лиды", metrics.leads.toString(), "все каналы лидогенерации"],
    ["Дозвоны", metrics.calls.toString(), "звонки с AI-разбором"],
    ["Сделки", metrics.deals.toString(), `${metrics.conversion}% конверсия`],
    ["MRR", money(metrics.mrr), "ежемесячная выручка"],
    ["Churn", `${metrics.churn}%`, "отток клиентов"],
    ["LTV", money(metrics.ltv), "средний жизненный цикл"]
  ];

  return (
    <div className="crm-shell">
      <aside className="crm-sidebar">
        <div className="mb-6 flex items-center gap-3 px-1 max-lg:justify-center">
          <div className="crm-brand-mark">OA</div>
          <div className="max-lg:hidden">
            <strong className="block text-sm">OptiAI CRM</strong>
            <span className="text-xs text-slate-400">Revenue operations</span>
          </div>
        </div>

        <nav className="grid gap-2">
          {navItems
            .filter((item) => allowedViews.includes(item.id))
            .map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveView(id)}
                className={clsx("crm-nav-item", activeView === id && "crm-nav-item-active")}
                title={VIEW_TITLES[id]}
              >
                <Icon size={20} />
                <span className="max-lg:hidden">{VIEW_TITLES[id]}</span>
              </button>
            ))}
        </nav>

        <button
          aria-label="Выйти из аккаунта"
          title="Выйти"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            setBootstrap(null);
          }}
          className="crm-nav-item mt-3 hidden place-items-center max-lg:grid"
        >
          <LogOut size={19} />
        </button>

        <div className="mt-auto border-t border-white/10 pt-4 max-lg:hidden">
          <span className="text-xs text-slate-400">Текущий аккаунт</span>
          <strong className="mt-1 block truncate text-sm text-white">{currentUser.fullName}</strong>
          <span className="block truncate text-xs text-slate-400">{currentUser.email}</span>
          <span className="mt-2 inline-flex rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-slate-200">{currentUser.role}</span>
          <p className="mt-3 text-xs leading-5 text-slate-400">{roleDescriptions[currentUser.role]}</p>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              setBootstrap(null);
            }}
            className="mt-3 flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </aside>

      <main className="crm-main">
        <header className="crm-topbar mb-6 max-xl:items-start max-xl:flex-col">
          <div>
            <p className="text-xs font-semibold text-slate-500">OptiAI / {VIEW_TITLES[activeView]}</p>
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
                    if (event.key === "Enter" && query.trim()) setActiveView("pipeline");
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
                    <button onClick={() => setActiveView("pipeline")} className="ui-button ui-button-secondary mt-1 w-full">Показать в воронке</button>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => selectedLead && openLead(selectedLead)}
              className="ui-button ui-button-secondary ui-icon-button"
              aria-label="Открыть текущего лида в воронке"
              title="Открыть в воронке"
            >
              <PhoneCall size={19} />
            </button>
            <button onClick={() => setModal("newLead")} className="ui-button ui-button-primary">
              <Plus size={18} /> Новый лид
            </button>
          </div>
        </header>

        {activeView === "dashboard" && (
          <section className="grid gap-4">
            <div className="grid grid-cols-6 gap-3 max-2xl:grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
              {dashboardCards.map(([label, value, hint]) => (
                <article key={label} className="crm-kpi">
                  <span className="text-xs font-semibold text-slate-500">{label}</span>
                  <strong className="mt-2 block text-2xl font-bold tabular-nums text-[#202939]">{value}</strong>
                  <small className="mt-1 block text-xs text-slate-500">{hint}</small>
                </article>
              ))}
            </div>

            <div className="grid grid-cols-[1.25fr_.75fr] gap-4 max-xl:grid-cols-1">
              <Panel title="AI-рекомендации на сегодня" subtitle="Утром менеджер получает звонки, задачи и следующий лучший шаг.">
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

              <Panel title="Каналы" subtitle="Instagram, Avito, Cold Call, Яндекс, Сайт, Telegram ads.">
                <div className="grid gap-2">
                  {["Instagram", "Avito", "Cold Call", "Яндекс директ", "Сайт", "Telegram ads"].map((channel) => {
                    const count = state.leads.filter((lead) => lead.sourceChannel === channel).length;
                    return (
                      <button key={channel} onClick={() => { setQuery(channel); setActiveView("pipeline"); }} className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-left transition-colors hover:border-[#AEB9FF]">
                        <div className="flex items-center justify-between">
                          <strong>{channel}</strong>
                          <span className="text-sm text-slate-500">{count} лидов</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-[#536DFE]" style={{ width: `${Math.max(8, count * 24)}%` }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            </div>
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
              <span className="text-sm text-slate-600">При “Не дозвонились” CRM автоматически ставит перезвоны 1/3/7 дней.</span>
            </div>
            <div className="grid auto-cols-[285px] grid-flow-col gap-3 overflow-x-auto pb-3">
              {STAGES.map((stage, index) => (
                <div key={stage} className="crm-pipeline-column">
                  <div className="mb-3 flex min-h-8 items-center justify-between gap-2 text-sm text-slate-500">
                    <strong className="text-[13px] font-semibold text-[#344054]">{stage}</strong>
                    <span className="grid size-6 place-items-center rounded-md bg-white text-xs font-semibold tabular-nums">{filteredLeads.filter((lead) => lead.stage === index).length}</span>
                  </div>
                  <div className="grid gap-3">
                    {filteredLeads
                      .filter((lead) => lead.stage === index)
                      .map((lead) => {
                        return (
                          <article key={lead.id} className={clsx("crm-lead-card", selectedLeadId === lead.id && "crm-lead-card-selected")}>
                            <button onClick={() => setSelectedLeadId(lead.id)} className="w-full text-left">
                              <span className="flex items-center gap-2">
                                <span className={clsx("size-2 rounded-full", lead.temperature === "hot" ? "bg-rose-500" : lead.temperature === "warm" ? "bg-amber-500" : "bg-slate-400")} />
                                <strong className="block text-sm text-[#202939]">{lead.companyName}</strong>
                              </span>
                              <span className="mt-1 block text-xs text-slate-600">{lead.contactName} · {lead.industry}</span>
                            </button>
                            <div className="mt-3 flex flex-wrap gap-1 text-xs">
                              <Badge>{lead.sourceChannel}</Badge>
                              <Badge>AI {lead.score}</Badge>
                              <Badge>{userName(lead.ownerId)}</Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {renderPipelineActions(lead)}
                              <button onClick={() => viewLead(lead)} className="ui-button ui-button-secondary min-h-8 px-2.5 py-1 text-xs">Детали</button>
                            </div>
                          </article>
                        );
                      })}
              {filteredLeads.filter((lead) => lead.stage === index).length === 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-center text-xs text-slate-500">Нет сделок</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeView === "lead" && selectedLead && (
          <LeadView
            lead={selectedLead}
            state={state}
            userName={userName}
            tariffName={tariffName}
            onOpenPipeline={() => openLead(selectedLead)}
          />
        )}
        {activeView === "lead" && !selectedLead && (
          <EmptyState title="Карточек компаний пока нет" text="Добавьте первого лида через кнопку “Новый лид”. CRM не содержит демонстрационных компаний и ложных данных." action={<button onClick={() => setModal("newLead")} className="ui-button ui-button-primary">Создать лид</button>} />
        )}

        {activeView === "callcenter" && (
          <section className="grid grid-cols-[.8fr_1.2fr] gap-4 max-xl:grid-cols-1">
            <Panel title="Список обзвона" subtitle="Клик по номеру, запись, расшифровка и AI-анализ.">
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

            <Panel title="Расшифровки и AI-анализ" subtitle="Текст разговора, summary, возражения, вероятность сделки, ошибки менеджера.">
              <div className="grid gap-3">
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
            <Panel title="Цепочки прогрева" subtitle="Можно менять, создавать и назначать вручную.">
              {state.warmupSequences.map((sequence) => (
                <div key={sequence.id} className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <strong>{sequence.name}</strong>
                      <p className="text-sm text-slate-600">{sequence.description}</p>
                    </div>
                    <button onClick={() => setModal("warmupStep")} className="ui-button ui-button-primary">Добавить шаг</button>
                  </div>
                  {sequence.steps.map((step) => (
                    <div key={step.id} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3 max-md:grid-cols-1">
                      <span className="grid min-h-11 place-items-center rounded-lg bg-[#EEF1FF] font-semibold text-[#4357D9]">День {step.day}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <p className="text-sm text-slate-600">{step.message}</p>
                      </div>
                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">Назначение в воронке</span>
                    </div>
                  ))}
                </div>
              ))}
            </Panel>

            <Panel title="Библиотека контента" subtitle="AI подбирает материал под боль клиента.">
              {["VSL OptiAI", "SEO-аудит", "Кейс клиента", "Аудит конкурентов", "Карта LLM-видимости"].map((item) => (
                <button key={item} onClick={() => setActiveView("pipeline")} className="mb-2 w-full rounded-lg border border-[#E5E7EB] bg-white p-3 text-left transition-colors hover:border-[#AEB9FF]">
                  <strong>{item}</strong>
                  <span className="block text-sm text-slate-600">Отправляется из этапа “Прогрев” в воронке</span>
                </button>
              ))}
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
                    <button onClick={() => lead && openLead(lead)} className="ui-button ui-button-primary">В воронку</button>
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
                  {state.users.map((user) => (
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
                        <span className="rounded-md bg-slate-50 p-2">{user.calls} звонков</span>
                        <span className="rounded-md bg-slate-50 p-2">{user.meetings} встреч</span>
                        <span className="rounded-md bg-slate-50 p-2">{money(user.revenue)}</span>
                        <span className="rounded-md bg-slate-50 p-2">{state.leads.filter((lead) => lead.ownerId === user.id).length} сделок</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-md bg-[#EEF1FF] px-3 py-2 text-sm font-semibold text-[#4357D9]">Вход только по паролю</span>
                        {currentUser.role === "Руководитель" && user.role !== "Руководитель" && (
                          <>
                            <button onClick={() => void runAction({ type: "disable_user", payload: { userId: user.id } }, "Аккаунт отключен, сделки переназначены.")} className="ui-button ui-button-secondary">Отключить</button>
                            <button onClick={() => window.confirm(`Удалить аккаунт ${user.fullName}? Это действие уберет пользователя из CRM.`) && void runAction({ type: "delete_user", payload: { userId: user.id } }, "Аккаунт удален из CRM.")} className="rounded-md bg-rose-100 px-3 py-2 text-sm font-bold text-rose-800">Удалить</button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
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
                    <select value={lead.ownerId} onChange={(event) => void runAction({ type: "assign_lead", payload: { leadId: lead.id, ownerId: event.target.value } }, "Ответственный изменен.")} className="ui-field">
                      {state.users.filter((user) => user.status === "active" && (user.role === "Менеджер" || user.role === "Аккаунт-менеджер")).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                    </select>
                    <button onClick={() => openLead(lead)} className="ui-button ui-button-secondary">Открыть</button>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        )}

        {activeView === "automations" && (
          <section className="grid grid-cols-[.9fr_1.1fr] gap-4 max-xl:grid-cols-1">
            <Panel title="Автоматизации" subtitle="3/7/14 дней без ответа и перезвоны после недозвона.">
              {[
                ["no_answer_3", "Нет ответа 3 дня", "Отправить сообщение"],
                ["no_answer_7", "Нет ответа 7 дней", "Создать задачу менеджеру"],
                ["no_answer_14", "Нет ответа 14 дней", "Запустить отдельный прогрев"],
                ["missed_call", "Не дозвонились", "Перезвонить через 1, 3 и 7 дней"]
              ].map(([key, title, detail]) => (
                <button key={key} onClick={() => void runAction({ type: "run_automation", payload: { key: key as "no_answer_3" } }, "Автоматизация выполнена.")} className="mb-2 w-full rounded-lg border border-[#E5E7EB] bg-white p-3 text-left transition-colors hover:border-[#AEB9FF]">
                  <strong>{title}</strong>
                  <span className="block text-sm text-slate-600">{detail}</span>
                </button>
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
        <ModalShell onClose={() => setModal(null)}>
          {modal === "newUser" && <NewUserForm currentUser={currentUser} onSubmit={(action) => { setModal(null); void runAction(action, "Аккаунт создан."); }} />}
          {modal === "newLead" && <NewLeadForm state={state} currentUser={currentUser} onSubmit={async (action) => { const ok = await runAction(action, "Лид создан и задача поставлена."); if (ok) setModal(null); }} />}
          {modal === "warmupStep" && <WarmupForm sequenceId={state.warmupSequences[0]?.id} onSubmit={(action) => { setModal(null); void runAction(action, "Шаг прогрева добавлен."); }} />}
          {modal === "refusal" && selectedLead && <RefusalForm leadId={selectedLead.id} onSubmit={(action) => { setModal(null); void runAction(action, "Отказ сохранен с причиной."); }} />}
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
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error || "Не удалось войти");
      setSubmitting(false);
      return;
    }
    await onLogin();
    setSubmitting(false);
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

        <form onSubmit={submit} className="grid content-center gap-5 p-10 max-md:p-6">
          <div>
            <h2 className="text-2xl font-bold text-[#202939]">Вход в CRM</h2>
            <p className="mt-2 text-sm text-slate-600">Введите рабочий email и пароль.</p>
          </div>
          <label className="ui-label">
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required className="ui-field" />
          </label>
          <label className="ui-label">
            Пароль
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required className="ui-field" />
          </label>
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>}
          <button disabled={submitting} className="ui-button ui-button-primary w-full">
            {submitting ? "Входим..." : "Войти"}
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

function LeadView({ lead, state, userName, tariffName, onOpenPipeline }: { lead: Lead; state: CrmState; userName: (id: string) => string; tariffName: (id?: string) => string; onOpenPipeline: () => void }) {
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

function NewUserForm({ currentUser, onSubmit }: { currentUser: CrmUser; onSubmit: (action: CrmAction) => void }) {
  const allowedRoles: Role[] = currentUser.role === "Руководитель"
    ? ["Менеджер", "Аккаунт-менеджер", "РОП", "Руководитель"]
    : ["Менеджер", "Аккаунт-менеджер"];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    onSubmit({ type: "create_user", payload: { fullName: data.fullName, email: data.email, role: data.role as Role, position: data.position, password: data.password } });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h2 className="pr-12 text-xl font-bold text-[#202939]">Добавить сотрудника</h2>
      <FormInput name="fullName" label="Имя и фамилия" required />
      <FormInput name="email" label="Email" type="email" required />
      <FormInput name="password" label="Временный пароль" type="password" required />
      <label className="ui-label">
        Роль
        <select name="role" className="ui-field">
          {allowedRoles.map((role) => <option key={role}>{role}</option>)}
        </select>
      </label>
      <FormInput name="position" label="Должность" required />
      <button className="ui-button ui-button-primary">Создать аккаунт</button>
    </form>
  );
}

const integrationFieldMap: Record<string, { name: string; label: string; type?: string; placeholder?: string }[]> = {
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
    { name: "spreadsheetId", label: "Spreadsheet ID" },
    { name: "serviceAccountEmail", label: "Service Account Email", type: "email" }
  ],
  metrika: [
    { name: "counterId", label: "Counter ID" },
    { name: "oauthToken", label: "OAuth Token" }
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

function IntegrationForm({ integration, onSubmit }: { integration?: CrmState["integrations"][number]; onSubmit: (action: CrmAction) => void }) {
  if (!integration) {
    return <EmptyState title="Интеграция не найдена" text="Закройте окно и выберите интеграцию заново." />;
  }

  const currentIntegration = integration;
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

function NewLeadForm({ state, currentUser, onSubmit }: { state: CrmState; currentUser: CrmUser; onSubmit: (action: CrmAction) => void }) {
  const activeOwners = state.users.filter((user) => user.status === "active");
  const salesOwners = activeOwners.filter((user) => user.role === "Менеджер" || user.role === "Аккаунт-менеджер" || user.role === "РОП");
  const ownerOptions = salesOwners.length > 0 ? salesOwners : activeOwners.filter((user) => user.role === "Руководитель");
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
        hasSeo: data.hasSeo === "yes",
        hasContext: data.hasContext === "yes",
        hasMarketer: data.hasMarketer === "yes",
        hasAgency: data.hasAgency === "yes",
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

function WarmupForm({ sequenceId, onSubmit }: { sequenceId?: string; onSubmit: (action: CrmAction) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    if (!sequenceId) return;
    onSubmit({ type: "create_warmup_step", payload: { sequenceId, day: Number(data.day), title: data.title, message: data.message } });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h2 className="pr-12 text-xl font-bold text-[#202939]">Новый шаг прогрева</h2>
      <FormInput name="day" label="День" type="number" required />
      <FormInput name="title" label="Название" required />
      <FormInput name="message" label="Сообщение/цель" required />
      <button className="ui-button ui-button-primary">Добавить</button>
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

function FormInput({ name, label, type = "text", required = false, defaultValue = "", placeholder }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return (
    <label className="ui-label">
      {label}
      <input name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} className="ui-field" />
    </label>
  );
}

function SelectBool({ name, label }: { name: string; label: string }) {
  return (
    <label className="ui-label">
      {label}
      <select name={name} className="ui-field">
        <option value="yes">Да</option>
        <option value="no">Нет</option>
      </select>
    </label>
  );
}
