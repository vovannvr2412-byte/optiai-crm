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
  MessageSquare,
  PhoneCall,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound
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

type Modal = "newUser" | "newLead" | "warmupStep" | "refusal" | null;

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

export function CrmApp() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [selectedLeadId, setSelectedLeadId] = useState("l-nord");
  const [query, setQuery] = useState("");
  const [temperature, setTemperature] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [modal, setModal] = useState<Modal>(null);
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
      return;
    }
    if (response.status === 403) {
      setToast("Недостаточно прав для действия.");
      setLoadingAction(false);
      return;
    }
    await load();
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
    setLoadingAction(false);
  }

  const state = bootstrap?.state;
  const metrics = bootstrap?.metrics;
  const currentUser = bootstrap?.currentUser;
  const allowedViews = currentUser ? ROLE_PERMISSIONS[currentUser.role] : ROLE_PERMISSIONS["Руководитель"];

  useEffect(() => {
    if (!allowedViews.includes(activeView)) setActiveView(allowedViews[0]);
  }, [activeView, allowedViews]);

  const selectedLead = useMemo(() => state?.leads.find((lead) => lead.id === selectedLeadId) ?? state?.leads[0], [selectedLeadId, state?.leads]);

  const filteredLeads = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (state?.leads ?? []).filter((lead) => {
      const matchesTemperature = temperature === "all" || lead.temperature === temperature;
      const haystack = [lead.companyName, lead.contactName, lead.sourceChannel, lead.industry, lead.region].join(" ").toLowerCase();
      return matchesTemperature && (!value || haystack.includes(value));
    });
  }, [query, state?.leads, temperature]);

  if (!authChecked) {
    return (
      <main className="grid min-h-screen place-items-center text-neutral-900">
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-xl">Загружаем OptiAI CRM...</div>
      </main>
    );
  }

  if (!bootstrap || !state || !metrics || !currentUser) {
    return <LoginScreen onLogin={load} />;
  }

  function openLead(lead: Lead, view: ViewId = "lead") {
    setSelectedLeadId(lead.id);
    setActiveView(view);
  }

  function userName(userId: string) {
    return (bootstrap?.state.users ?? []).find((user) => user.id === userId)?.fullName ?? "Не назначен";
  }

  function tariffName(tariffId?: string) {
    const tariff = (bootstrap?.state.tariffs ?? []).find((item) => item.id === tariffId);
    return tariff ? `${tariff.name} · ${money(tariff.price)}` : "тариф не выбран";
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
    <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)] max-lg:grid-cols-[90px_minmax(0,1fr)] max-md:block">
      <aside className="sticky top-0 flex h-screen flex-col border-r border-white/10 bg-[#24231f] p-4 text-stone-100 max-md:static max-md:h-auto">
        <div className="mb-6 flex items-center gap-3 px-1 max-lg:justify-center">
          <div className="grid size-11 place-items-center rounded-lg bg-gradient-to-br from-lime-200 via-teal-300 to-white font-black text-stone-950">OA</div>
          <div className="max-lg:hidden">
            <strong className="block">OptiAI CRM</strong>
            <span className="text-sm text-stone-400">Revenue Operating System</span>
          </div>
        </div>

        <nav className="grid gap-2">
          {navItems
            .filter((item) => allowedViews.includes(item.id))
            .map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveView(id)}
                className={clsx(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition max-lg:justify-center",
                  activeView === id ? "bg-white/10 text-white" : "text-stone-300 hover:bg-white/5"
                )}
              >
                <Icon size={20} />
                <span className="max-lg:hidden">{VIEW_TITLES[id]}</span>
              </button>
            ))}
        </nav>

        <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-3 max-lg:hidden">
          <span className="text-xs uppercase text-stone-400">Вы вошли как</span>
          <strong className="mt-2 block text-sm text-white">{currentUser.fullName}</strong>
          <span className="text-xs text-stone-400">{currentUser.email}</span>
          <Badge>{currentUser.role}</Badge>
          <p className="mt-3 text-xs text-stone-400">{roleDescriptions[currentUser.role]}</p>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              setBootstrap(null);
            }}
            className="mt-3 w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/15"
          >
            Выйти
          </button>
        </div>
      </aside>

      <main className="min-w-0 p-6 max-md:p-4">
        <header className="mb-5 flex items-start justify-between gap-4 max-xl:flex-col">
          <div>
            <p className="text-xs font-black uppercase text-teal-700">SEO + GEO на автопилоте</p>
            <h1 className="text-4xl font-black tracking-normal text-stone-950 max-md:text-3xl">{VIEW_TITLES[activeView]}</h1>
            <p className="mt-2 max-w-3xl text-sm text-stone-600">API-first CRM на Next.js, React, Tailwind и Supabase/PostgreSQL-модели: лиды, прогрев, звонки, подписки, AI-скоринг и удержание.</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex min-h-11 w-80 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 max-md:w-full">
              <Search size={18} className="text-stone-500" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Компания, контакт, канал" className="w-full bg-transparent outline-none" />
            </div>
            <button onClick={() => selectedLead && void runAction({ type: "record_call", payload: { leadId: selectedLead.id, ownerId: currentUser.id } }, "Звонок записан, AI обновил карточку.")} className="grid size-11 place-items-center rounded-lg border border-stone-200 bg-white text-stone-900">
              <Sparkles size={19} />
            </button>
            <button onClick={() => setModal("newLead")} className="flex min-h-11 items-center gap-2 rounded-lg bg-stone-950 px-4 font-bold text-white">
              <Plus size={18} /> Новый лид
            </button>
          </div>
        </header>

        {activeView === "dashboard" && (
          <section className="grid gap-4">
            <div className="grid grid-cols-6 gap-3 max-2xl:grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
              {dashboardCards.map(([label, value, hint]) => (
                <article key={label} className="rounded-lg border border-stone-200 bg-white/90 p-4 shadow-lg shadow-stone-900/5">
                  <span className="text-sm text-stone-500">{label}</span>
                  <strong className="mt-2 block text-2xl font-black text-stone-950">{value}</strong>
                  <small className="text-stone-500">{hint}</small>
                </article>
              ))}
            </div>

            <div className="grid grid-cols-[1.25fr_.75fr] gap-4 max-xl:grid-cols-1">
              <Panel title="AI-рекомендации на сегодня" subtitle="Утром менеджер получает звонки, задачи и следующий лучший шаг.">
                <div className="grid gap-3">
                  {state.tasks
                    .filter((task) => task.status === "open")
                    .slice(0, 5)
                    .map((task) => {
                      const lead = state.leads.find((item) => item.id === task.leadId);
                      return (
                        <button key={task.id} onClick={() => lead && openLead(lead)} className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-left hover:border-teal-400">
                          <strong className="block text-stone-950">{task.title}</strong>
                          <span className="text-sm text-stone-600">{lead?.companyName} · {userName(task.ownerId)} · до {dateLabel(task.dueAt)}</span>
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
                      <button key={channel} onClick={() => { setQuery(channel); setActiveView("pipeline"); }} className="rounded-lg border border-stone-200 bg-white p-3 text-left">
                        <div className="flex items-center justify-between">
                          <strong>{channel}</strong>
                          <span className="text-sm text-stone-500">{count} лидов</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-stone-100">
                          <div className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-lime-300" style={{ width: `${Math.max(8, count * 24)}%` }} />
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
              <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1">
                {(["all", "hot", "warm", "cold"] as const).map((item) => (
                  <button key={item} onClick={() => setTemperature(item)} className={clsx("rounded-md px-3 py-2 text-sm font-bold", temperature === item ? "bg-stone-950 text-white" : "text-stone-600")}>
                    {item === "all" ? "Все" : item === "hot" ? "Горячие" : item === "warm" ? "Теплые" : "Холодные"}
                  </button>
                ))}
              </div>
              <span className="text-sm text-stone-600">При “Не дозвонились” CRM автоматически ставит перезвоны 1/3/7 дней.</span>
            </div>
            <div className="grid auto-cols-[285px] grid-flow-col gap-3 overflow-x-auto pb-3">
              {STAGES.map((stage, index) => (
                <div key={stage} className="min-h-[560px] rounded-lg border border-stone-200 bg-white/70 p-3">
                  <div className="mb-3 flex items-center justify-between text-sm text-stone-500">
                    <strong className="text-stone-800">{stage}</strong>
                    <span>{filteredLeads.filter((lead) => lead.stage === index).length}</span>
                  </div>
                  <div className="grid gap-3">
                    {filteredLeads
                      .filter((lead) => lead.stage === index)
                      .map((lead) => (
                        <article key={lead.id} className={clsx("rounded-lg border bg-white p-3 shadow-sm", lead.temperature === "hot" ? "border-l-4 border-l-rose-500" : lead.temperature === "warm" ? "border-l-4 border-l-amber-500" : "border-l-4 border-l-teal-500")}>
                          <button onClick={() => openLead(lead)} className="w-full text-left">
                            <strong className="block">{lead.companyName}</strong>
                            <span className="text-sm text-stone-600">{lead.contactName} · {lead.industry}</span>
                          </button>
                          <div className="mt-3 flex flex-wrap gap-1 text-xs">
                            <Badge>{lead.sourceChannel}</Badge>
                            <Badge>AI {lead.score}</Badge>
                            <Badge>{userName(lead.ownerId)}</Badge>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button disabled={loadingAction || lead.stage >= 12} onClick={() => void runAction({ type: "move_stage", payload: { leadId: lead.id, stage: Math.min(12, lead.stage + 1) } }, `${lead.companyName}: этап обновлен.`)} className="rounded-md bg-teal-50 px-2 py-1 text-xs font-bold text-teal-800">Следующий</button>
                            <button onClick={() => openLead(lead, "callcenter")} className="rounded-md bg-stone-100 px-2 py-1 text-xs font-bold text-stone-800">Звонок</button>
                          </div>
                        </article>
                      ))}
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
            onAction={runAction}
            onRefusal={() => setModal("refusal")}
          />
        )}

        {activeView === "callcenter" && (
          <section className="grid grid-cols-[.8fr_1.2fr] gap-4 max-xl:grid-cols-1">
            <Panel title="Список обзвона" subtitle="Клик по номеру, запись, расшифровка и AI-анализ.">
              <div className="grid gap-3">
                {state.leads.filter((lead) => lead.status !== "lost").map((lead) => (
                  <div key={lead.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3">
                    <button onClick={() => openLead(lead)} className="text-left">
                      <strong className="block">{lead.companyName}</strong>
                      <span className="text-sm text-stone-600">{lead.phone} · {lead.nextStep}</span>
                    </button>
                    <button onClick={() => void runAction({ type: "record_call", payload: { leadId: lead.id, ownerId: currentUser.id } }, "Звонок завершен, AI-summary добавлено.")} className="rounded-lg bg-teal-600 px-3 py-2 font-bold text-white">Звонок</button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Расшифровки и AI-анализ" subtitle="Текст разговора, summary, возражения, вероятность сделки, ошибки менеджера.">
              <div className="grid gap-3">
                {state.callRecords.slice(0, 5).map((call) => {
                  const lead = state.leads.find((item) => item.id === call.leadId);
                  return (
                    <article key={call.id} className="rounded-lg border border-stone-200 bg-white p-4">
                      <strong>{lead?.companyName}</strong>
                      <p className="mt-2 text-sm text-stone-700">{call.transcript}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm max-md:grid-cols-1">
                        <Badge>Интерес {call.interest}%</Badge>
                        <Badge>Вероятность {call.dealProbability}%</Badge>
                      </div>
                      <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm">{call.summary}</p>
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
                      <p className="text-sm text-stone-600">{sequence.description}</p>
                    </div>
                    <button onClick={() => setModal("warmupStep")} className="rounded-lg bg-stone-950 px-3 py-2 font-bold text-white">Добавить шаг</button>
                  </div>
                  {sequence.steps.map((step) => (
                    <div key={step.id} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 rounded-lg border border-stone-200 bg-white p-3 max-md:grid-cols-1">
                      <span className="grid min-h-11 place-items-center rounded-lg bg-teal-50 font-black text-teal-800">День {step.day}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <p className="text-sm text-stone-600">{step.message}</p>
                      </div>
                      {selectedLead && <button onClick={() => void runAction({ type: "start_warmup", payload: { leadId: selectedLead.id, sequenceId: sequence.id } }, "Цепочка прогрева назначена.")} className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 font-bold text-teal-800">Назначить</button>}
                    </div>
                  ))}
                </div>
              ))}
            </Panel>

            <Panel title="Библиотека контента" subtitle="AI подбирает материал под боль клиента.">
              {["VSL OptiAI", "SEO-аудит", "Кейс CPL -47%", "Аудит конкурентов", "Карта LLM-видимости"].map((item) => (
                <button key={item} onClick={() => selectedLead && void runAction({ type: "send_message", payload: { leadId: selectedLead.id, channel: "Telegram", text: `Отправлен материал: ${item}` } }, `${item} отправлен текущему лиду.`)} className="mb-2 w-full rounded-lg border border-stone-200 bg-white p-3 text-left">
                  <strong>{item}</strong>
                  <span className="block text-sm text-stone-600">Отправить в последний активный канал</span>
                </button>
              ))}
            </Panel>
          </section>
        )}

        {activeView === "subscriptions" && (
          <Panel title="Подписки и продления" subtitle="Тариф, стоимость, старт, окончание, следующий платеж, история оплат.">
            <div className="grid gap-3">
              {state.subscriptions.map((subscription) => {
                const lead = state.leads.find((item) => item.id === subscription.leadId);
                return (
                  <div key={subscription.id} className="grid grid-cols-[1.2fr_1fr_1fr_1fr_auto] items-center gap-3 rounded-lg border border-stone-200 bg-white p-3 max-xl:grid-cols-1">
                    <strong>{lead?.companyName}</strong>
                    <span>{tariffName(subscription.tariffId)}</span>
                    <span>Платеж: {dateLabel(subscription.nextPaymentAt)}</span>
                    <span>Договор до {dateLabel(subscription.endsAt)}</span>
                    <button onClick={() => void runAction({ type: "renew_subscription", payload: { subscriptionId: subscription.id } }, "Продление запущено.")} className="rounded-lg bg-amber-100 px-3 py-2 font-bold text-amber-900">Продлить</button>
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
                subtitle="Добавление руководителей, РОПов, менеджеров и аккаунт-менеджеров выполняет только руководитель."
                action={
                  currentUser.role === "Руководитель" ? (
                    <button onClick={() => setModal("newUser")} className="rounded-lg bg-stone-950 px-3 py-2 font-bold text-white">Добавить сотрудника</button>
                  ) : (
                    <span className="rounded-lg bg-stone-100 px-3 py-2 text-sm font-bold text-stone-600">Создает только руководитель</span>
                  )
                }
              >
                <div className="grid gap-3">
                  {state.users.map((user) => (
                    <article key={user.id} className="rounded-lg border border-stone-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
                        <div className="flex items-center gap-3">
                          <div className="grid size-11 place-items-center rounded-lg bg-gradient-to-br from-lime-200 to-teal-300 font-black">{initials(user.fullName)}</div>
                          <div>
                            <strong className="block">{user.fullName}</strong>
                            <span className="text-sm text-stone-600">{user.position} · {user.email}</span>
                          </div>
                        </div>
                        <Badge>{user.role}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2 text-sm max-md:grid-cols-2">
                        <span className="rounded-md bg-stone-50 p-2">{user.calls} звонков</span>
                        <span className="rounded-md bg-stone-50 p-2">{user.meetings} встреч</span>
                        <span className="rounded-md bg-stone-50 p-2">{money(user.revenue)}</span>
                        <span className="rounded-md bg-stone-50 p-2">{state.leads.filter((lead) => lead.ownerId === user.id).length} сделок</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-md bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800">Вход только по паролю</span>
                        {currentUser.role === "Руководитель" && user.role !== "Руководитель" && <button onClick={() => void runAction({ type: "disable_user", payload: { userId: user.id } }, "Аккаунт отключен, сделки переназначены.")} className="rounded-md bg-stone-100 px-3 py-2 text-sm font-bold">Отключить</button>}
                      </div>
                    </article>
                  ))}
                </div>
              </Panel>

              <Panel title="Права ролей" subtitle="Ролевые ограничения из ТЗ.">
                <div className="grid gap-3">
                  {(Object.keys(ROLE_PERMISSIONS) as Role[]).map((role) => (
                    <div key={role} className="rounded-lg border border-stone-200 bg-white p-3">
                      <strong>{role}</strong>
                      <p className="text-sm text-stone-600">{roleDescriptions[role]}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{ROLE_PERMISSIONS[role].map((view) => <Badge key={view}>{VIEW_TITLES[view]}</Badge>)}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <Panel title="Назначение сделок" subtitle="Руководитель и РОП управляют ответственными за лидов и клиентов.">
              <div className="grid gap-2">
                {state.leads.map((lead) => (
                  <div key={lead.id} className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-center gap-3 rounded-lg border border-stone-200 bg-white p-3 max-lg:grid-cols-1">
                    <strong>{lead.companyName}</strong>
                    <span>{STAGES[lead.stage]}</span>
                    <select value={lead.ownerId} onChange={(event) => void runAction({ type: "assign_lead", payload: { leadId: lead.id, ownerId: event.target.value } }, "Ответственный изменен.")} className="rounded-md border border-stone-200 px-3 py-2">
                      {state.users.filter((user) => user.status === "active" && (user.role === "Менеджер" || user.role === "Аккаунт-менеджер")).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                    </select>
                    <button onClick={() => openLead(lead)} className="rounded-md bg-stone-100 px-3 py-2 font-bold">Открыть</button>
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
                <button key={key} onClick={() => void runAction({ type: "run_automation", payload: { key: key as "no_answer_3" } }, "Автоматизация выполнена.")} className="mb-2 w-full rounded-lg border border-stone-200 bg-white p-3 text-left">
                  <strong>{title}</strong>
                  <span className="block text-sm text-stone-600">{detail}</span>
                </button>
              ))}
            </Panel>

            <Panel title="Интеграции" subtitle="Коммуникации, платежи, аналитика и телефония из ТЗ.">
              <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
                {state.integrations.map((integration) => (
                  <button key={integration.id} onClick={() => void runAction({ type: "toggle_integration", payload: { integrationId: integration.id } }, "Статус интеграции изменен.")} className="rounded-lg border border-stone-200 bg-white p-3 text-left">
                    <strong className="block">{integration.name}</strong>
                    <span className="text-sm text-stone-600">{integration.description}</span>
                    <Badge>{integration.status === "connected" ? "подключено" : integration.status === "needs_setup" ? "настроить" : "ошибка"}</Badge>
                  </button>
                ))}
              </div>
            </Panel>
          </section>
        )}
      </main>

      {modal && (
        <ModalShell onClose={() => setModal(null)}>
          {modal === "newUser" && <NewUserForm onSubmit={(action) => { setModal(null); void runAction(action, "Аккаунт создан."); }} />}
          {modal === "newLead" && <NewLeadForm state={state} onSubmit={(action) => { setModal(null); void runAction(action, "Лид создан и задача поставлена."); }} />}
          {modal === "warmupStep" && <WarmupForm sequenceId={state.warmupSequences[0]?.id} onSubmit={(action) => { setModal(null); void runAction(action, "Шаг прогрева добавлен."); }} />}
          {modal === "refusal" && selectedLead && <RefusalForm leadId={selectedLead.id} onSubmit={(action) => { setModal(null); void runAction(action, "Отказ сохранен с причиной."); }} />}
        </ModalShell>
      )}

      {toast && <div className="fixed bottom-5 right-5 z-50 max-w-md rounded-lg bg-stone-950 px-4 py-3 text-sm font-semibold text-white shadow-2xl">{toast}</div>}
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
    <main className="grid min-h-screen place-items-center p-4">
      <section className="grid w-[min(1040px,100%)] grid-cols-[.9fr_1.1fr] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl max-lg:grid-cols-1">
        <div className="bg-[#24231f] p-8 text-white">
          <div className="grid size-12 place-items-center rounded-lg bg-gradient-to-br from-lime-200 via-teal-300 to-white font-black text-stone-950">OA</div>
          <h1 className="mt-8 text-4xl font-black">Вход в OptiAI CRM</h1>
          <p className="mt-4 text-stone-300">Каждый сотрудник входит по своему email и паролю. После входа CRM показывает только доступные разделы и данные по роли.</p>
          <div className="mt-8 grid gap-3 text-sm">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <strong className="block">Нет публичного списка аккаунтов</strong>
              <span className="text-stone-300">Логины и временные пароли выдает руководитель внутри CRM.</span>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <strong className="block">Ролевой доступ</strong>
              <span className="text-stone-300">Менеджер видит свои сделки, руководитель управляет командой и аккаунтами.</span>
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="grid content-center gap-4 p-8">
          <div>
            <p className="text-xs font-black uppercase text-teal-700">Защищенная сессия</p>
            <h2 className="text-3xl font-black text-stone-950">Логин и пароль</h2>
          </div>
          <label className="grid gap-1 text-sm font-bold text-stone-600">
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required className="rounded-lg border border-stone-200 px-3 py-3 text-stone-950 outline-none focus:border-teal-500" />
          </label>
          <label className="grid gap-1 text-sm font-bold text-stone-600">
            Пароль
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required className="rounded-lg border border-stone-200 px-3 py-3 text-stone-950 outline-none focus:border-teal-500" />
          </label>
          {error && <div className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
          <button disabled={submitting} className="rounded-lg bg-stone-950 px-4 py-3 font-bold text-white">
            {submitting ? "Входим..." : "Войти"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white/90 p-4 shadow-lg shadow-stone-900/5">
      <div className="mb-4 flex items-start justify-between gap-3 max-md:flex-col">
        <div>
          <h2 className="text-xl font-black text-stone-950">{title}</h2>
          <p className="text-sm text-stone-600">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-full bg-stone-100 px-2 py-1 text-xs font-bold text-stone-700">{children}</span>;
}

function LeadView({ lead, state, userName, tariffName, onAction, onRefusal }: { lead: Lead; state: CrmState; userName: (id: string) => string; tariffName: (id?: string) => string; onAction: (action: CrmAction, message: string) => Promise<void>; onRefusal: () => void }) {
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
              <div key={label} className="rounded-lg border border-stone-200 bg-white p-3">
                <span className="text-xs font-bold uppercase text-stone-500">{label}</span>
                <strong className="mt-1 block break-words text-stone-950">{value}</strong>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void onAction({ type: "record_call", payload: { leadId: lead.id, ownerId: lead.ownerId } }, "Звонок обработан AI.")} className="rounded-lg bg-teal-600 px-3 py-2 font-bold text-white">Позвонить</button>
            <button onClick={() => void onAction({ type: "send_message", payload: { leadId: lead.id, channel: "Telegram", text: "Отправлено персональное касание из CRM." } }, "Сообщение отправлено.")} className="rounded-lg bg-stone-100 px-3 py-2 font-bold">Сообщение</button>
            <button onClick={() => void onAction({ type: "start_warmup", payload: { leadId: lead.id, sequenceId: state.warmupSequences[0].id } }, "Прогрев запущен.")} className="rounded-lg bg-amber-100 px-3 py-2 font-bold text-amber-900">Прогрев</button>
            <button onClick={() => void onAction({ type: "mark_paid", payload: { leadId: lead.id, tariffId: lead.tariffId ?? state.tariffs[0].id } }, "Оплата отмечена.")} className="rounded-lg bg-lime-100 px-3 py-2 font-bold text-lime-900">Оплата</button>
            <button onClick={onRefusal} className="rounded-lg bg-rose-100 px-3 py-2 font-bold text-rose-900">Отказ</button>
          </div>
        </Panel>

        <Panel title="AI-ассистент" subtitle="Автозаполнение после звонка, боли, summary, следующий шаг, контент.">
          <div className="grid gap-3">
            <Info title="Боль" text={lead.pain} />
            <Info title="Каналы продвижения" text={lead.currentPromotionChannels} />
            <Info title="Бюджет" text={lead.budget} />
            <Info title="Следующий шаг" text={lead.nextStep} />
            <Info title="Контент прогрева" text={lead.pain.includes("Директ") ? "Кейс: как снизили стоимость лида на 47% через SEO." : "SEO + GEO аудит и карта конкурентов."} />
            {lead.refusalReason && <Info title="Причина отказа" text={lead.refusalReason} />}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-[1fr_.8fr] gap-4 max-xl:grid-cols-1">
        <Panel title="История коммуникаций" subtitle="Сообщения, звонки, задачи, оплаты и прогревы хранятся в CRM.">
          <div className="grid gap-2">
            {activities.map((activity) => (
              <div key={activity.id} className="grid grid-cols-[110px_1fr] gap-3 rounded-lg border border-stone-200 bg-white p-3 max-md:grid-cols-1">
                <span className="text-sm text-stone-500">{dateLabel(activity.createdAt)}</span>
                <div>
                  <strong>{activity.title}</strong>
                  <p className="text-sm text-stone-600">{activity.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Подписка" subtitle="Срок договора, платежи и уведомления 30/14/7/3 дня.">
          <div className="rounded-lg bg-stone-950 p-4 text-white">
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
    <div className="rounded-lg bg-stone-50 p-3">
      <strong className="block text-stone-950">{title}</strong>
      <span className="text-sm text-stone-700">{text}</span>
    </div>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Закрыть" onClick={onClose} className="absolute inset-0 bg-stone-950/40" />
      <section className="relative mx-auto mt-8 max-h-[calc(100vh-64px)] w-[min(680px,calc(100vw-32px))] overflow-auto rounded-lg border border-stone-200 bg-white p-5 shadow-2xl">
        {children}
      </section>
    </div>
  );
}

function NewUserForm({ onSubmit }: { onSubmit: (action: CrmAction) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    onSubmit({ type: "create_user", payload: { fullName: data.fullName, email: data.email, role: data.role as Role, position: data.position, password: data.password } });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h2 className="text-2xl font-black">Добавить сотрудника</h2>
      <FormInput name="fullName" label="Имя и фамилия" required />
      <FormInput name="email" label="Email" type="email" required />
      <FormInput name="password" label="Временный пароль" type="password" required />
      <label className="grid gap-1 text-sm font-bold text-stone-600">
        Роль
        <select name="role" className="rounded-lg border border-stone-200 px-3 py-2 text-stone-950">
          <option>Менеджер</option>
          <option>Аккаунт-менеджер</option>
          <option>РОП</option>
          <option>Руководитель</option>
        </select>
      </label>
      <FormInput name="position" label="Должность" required />
      <button className="rounded-lg bg-stone-950 px-4 py-3 font-bold text-white">Создать аккаунт</button>
    </form>
  );
}

function NewLeadForm({ state, onSubmit }: { state: CrmState; onSubmit: (action: CrmAction) => void }) {
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
        ownerId: data.ownerId,
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
      <h2 className="col-span-full text-2xl font-black">Новый лид</h2>
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
      <label className="grid gap-1 text-sm font-bold text-stone-600">
        Канал
        <select name="sourceChannel" className="rounded-lg border border-stone-200 px-3 py-2 text-stone-950">
          {["Cold Call", "Instagram", "Avito", "Telegram ads", "Яндекс директ", "Сайт"].map((channel) => <option key={channel}>{channel}</option>)}
        </select>
      </label>
      <FormInput name="sourceDetail" label="Источник внутри канала" />
      <label className="grid gap-1 text-sm font-bold text-stone-600">
        Ответственный
        <select name="ownerId" className="rounded-lg border border-stone-200 px-3 py-2 text-stone-950">
          {state.users.filter((user) => user.status === "active" && (user.role === "Менеджер" || user.role === "Аккаунт-менеджер")).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-bold text-stone-600">
        Тариф
        <select name="tariffId" className="rounded-lg border border-stone-200 px-3 py-2 text-stone-950">
          {state.tariffs.map((tariff) => <option key={tariff.id} value={tariff.id}>{tariff.name} · {money(tariff.price)}</option>)}
        </select>
      </label>
      <button className="col-span-full rounded-lg bg-stone-950 px-4 py-3 font-bold text-white">Создать лид</button>
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
      <h2 className="text-2xl font-black">Новый шаг прогрева</h2>
      <FormInput name="day" label="День" type="number" required />
      <FormInput name="title" label="Название" required />
      <FormInput name="message" label="Сообщение/цель" required />
      <button className="rounded-lg bg-stone-950 px-4 py-3 font-bold text-white">Добавить</button>
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
      <h2 className="text-2xl font-black">Причина отказа</h2>
      <label className="grid gap-1 text-sm font-bold text-stone-600">
        Причина
        <select name="reason" className="rounded-lg border border-stone-200 px-3 py-2 text-stone-950">
          <option>Не готов к бюджету</option>
          <option>Нет срочности</option>
          <option>Уже есть агентство</option>
          <option>Нет доверия к SEO</option>
          <option>Вернуться через 3 месяца</option>
        </select>
      </label>
      <button className="rounded-lg bg-rose-700 px-4 py-3 font-bold text-white">Сохранить отказ</button>
    </form>
  );
}

function FormInput({ name, label, type = "text", required = false }: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <label className="grid gap-1 text-sm font-bold text-stone-600">
      {label}
      <input name={name} type={type} required={required} className="rounded-lg border border-stone-200 px-3 py-2 text-stone-950 outline-none focus:border-teal-500" />
    </label>
  );
}

function SelectBool({ name, label }: { name: string; label: string }) {
  return (
    <label className="grid gap-1 text-sm font-bold text-stone-600">
      {label}
      <select name={name} className="rounded-lg border border-stone-200 px-3 py-2 text-stone-950">
        <option value="yes">Да</option>
        <option value="no">Нет</option>
      </select>
    </label>
  );
}
