"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  blocks as seedBlocks,
  defaultKpis,
  defaultRoutines,
  defaultSettings,
  owners as seedOwners,
  blockColors,
  type Frequency,
  type KPI,
  type Routine,
} from "@/lib/routines/seed";

type Tab = "week" | "routines" | "metrics" | "settings";
type TaskStatus = "К выполнению" | "В работе" | "Готово";
type Task = {
  id: string;
  title: string;
  date: string;
  block: string;
  owner: string;
  ownerId?: string;
  participants: string;
  time: string;
  notes: string;
  status: TaskStatus;
};
export type RoutinesSavedState = {
  routines: Routine[];
  tasks?: Task[];
  kpis: KPI[];
  settings: typeof defaultSettings;
  completed: string[];
  team: string[];
  categories: string[];
};

const nav: { id: Tab; label: string; mark: string }[] = [
  { id: "week", label: "Неделя", mark: "▦" },
  { id: "routines", label: "Все рутины", mark: "≡" },
  { id: "metrics", label: "Показатели", mark: "↗" },
  { id: "settings", label: "Настройки", mark: "⚙" },
];

const dayShort: Record<string, string> = {
  Понедельник: "ПН",
  Вторник: "ВТ",
  Среда: "СР",
  Четверг: "ЧТ",
  Пятница: "ПТ",
};

const emptyRoutine = (owners: string[], blocks: string[]): Routine => ({
  id: "",
  frequency: "Еженедельно",
  when: "Понедельник",
  days: ["Понедельник"],
  block: blocks[0] ?? "Управление",
  title: "",
  owner: owners[0] ?? "Константин",
  participants: "—",
  duration: "30 мин",
  time: "10:00",
  result: "",
  metric: "",
  target: "",
  status: "Активна",
});

const storageKeys = {
  routines: "optiai-os-routines-v1",
  tasks: "optiai-os-tasks-v1",
  kpis: "optiai-os-kpis-v1",
  settings: "optiai-os-settings-v2",
  completed: "optiai-os-completed-v2",
  owners: "optiai-os-owners-v1",
  blocks: "optiai-os-blocks-v1",
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const emptyTask = (owners: string[], blocks: string[], date: Date): Task => ({
  id: "",
  title: "",
  date: dateKey(date),
  block: blocks[0] ?? "Управление",
  owner: owners[0] ?? "Константин",
  participants: "—",
  time: "17:00",
  notes: "",
  status: "К выполнению",
});

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, amount: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function formatRange(monday: Date) {
  const friday = addDays(monday, 4);
  const left = monday.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const right = friday.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  return `${left} — ${right}`;
}

function progressFor(kpi: KPI) {
  if (kpi.reverse) return kpi.fact <= kpi.plan ? 100 : 0;
  if (!kpi.plan) return 0;
  return Math.max(0, Math.min(100, Math.round((kpi.fact / kpi.plan) * 100)));
}

export function RoutinesModule({ teamMembers = [] }: { teamMembers?: { id: string; fullName: string }[] }) {
  const [tab, setTab] = useState<Tab>("week");
  const [routines, setRoutines] = useState<Routine[]>(defaultRoutines);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [kpis, setKpis] = useState<KPI[]>(defaultKpis);
  const [settings, setSettings] = useState(defaultSettings);
  const realTeam = useMemo(() => teamMembers.map((member) => member.fullName), [teamMembers]);
  const initialTeam = useMemo(() => realTeam.length ? realTeam : seedOwners, [realTeam]);
  const [team, setTeam] = useState(initialTeam);
  const [categories, setCategories] = useState(seedBlocks);
  const [completed, setCompleted] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskModalMode, setTaskModalMode] = useState<"edit" | "create">("create");
  const [modalMode, setModalMode] = useState<"edit" | "create">("edit");
  const [query, setQuery] = useState("");
  const [frequency, setFrequency] = useState<"Все" | Frequency>("Все");
  const [ownerFilter, setOwnerFilter] = useState("Все");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [syncState, setSyncState] = useState("Подключаем хранилище");
  const cloudVersion = useRef(0);

  useEffect(() => {
    const safeLoad = <T,>(key: string, fallback: T): T => {
      try {
        const saved = localStorage.getItem(key);
        return saved ? (JSON.parse(saved) as T) : fallback;
      } catch {
        return fallback;
      }
    };
    const localState: RoutinesSavedState = {
      routines: safeLoad(storageKeys.routines, defaultRoutines),
      tasks: safeLoad(storageKeys.tasks, []),
      kpis: safeLoad(storageKeys.kpis, defaultKpis),
      settings: safeLoad(storageKeys.settings, defaultSettings),
      completed: safeLoad(storageKeys.completed, []),
      team: safeLoad(storageKeys.owners, initialTeam),
      categories: safeLoad(storageKeys.blocks, seedBlocks),
    };
    let cancelled = false;

    fetch("/api/routines/state", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cloud state is unavailable");
        return (await response.json()) as { state: RoutinesSavedState | null; version: number };
      })
      .then((payload) => {
        if (cancelled) return;
        cloudVersion.current = payload.version;
        const state = payload.state ?? localState;
        setRoutines(state.routines ?? defaultRoutines);
        setTasks(state.tasks ?? []);
        setKpis(state.kpis ?? defaultKpis);
        setSettings(state.settings ?? defaultSettings);
        setCompleted(state.completed ?? []);
        setTeam(realTeam.length ? realTeam : state.team ?? seedOwners);
        setCategories(state.categories ?? seedBlocks);
        setSyncState("Сохранено в общем хранилище");
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setRoutines(localState.routines);
        setTasks(localState.tasks ?? []);
        setKpis(localState.kpis);
        setSettings(localState.settings);
        setCompleted(localState.completed);
        setTeam(localState.team);
        setCategories(localState.categories);
        setSyncState("Офлайн-копия активна");
        setHydrated(true);
      });

    return () => { cancelled = true; };
  }, [initialTeam, realTeam]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(storageKeys.routines, JSON.stringify(routines));
    localStorage.setItem(storageKeys.tasks, JSON.stringify(tasks));
    localStorage.setItem(storageKeys.kpis, JSON.stringify(kpis));
    localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
    localStorage.setItem(storageKeys.completed, JSON.stringify(completed));
    localStorage.setItem(storageKeys.owners, JSON.stringify(team));
    localStorage.setItem(storageKeys.blocks, JSON.stringify(categories));
    const timer = window.setTimeout(() => {
      const state: RoutinesSavedState = { routines, tasks, kpis, settings, completed, team, categories };
      fetch("/api/routines/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, expectedVersion: cloudVersion.current }),
      })
        .then(async (response) => {
          const payload = await response.json() as { version?: number; error?: string };
          if (!response.ok) throw new Error(payload.error || "Cloud save failed");
          cloudVersion.current = payload.version ?? cloudVersion.current;
          setSyncState("Сохранено в общем хранилище");
        })
        .catch((error: Error) => setSyncState(error.message));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [routines, tasks, kpis, settings, completed, team, categories, hydrated]);

  const monday = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const weekStart = dateKey(monday);
  const completionKey = (routineId: string) => `${routineId}:${weekStart}`;
  const activeWeekly = routines.filter((item) => item.frequency === "Еженедельно" && item.status === "Активна");
  const daily = routines.filter((item) => item.frequency === "Ежедневно" && item.status === "Активна");
  const doneWeekly = activeWeekly.filter((item) => completed.includes(completionKey(item.id))).length;
  const currentWeekDates = settings.workdays.map((_, index) => dateKey(addDays(monday, index)));
  const weekTasks = tasks.filter((item) => currentWeekDates.includes(item.date));
  const doneTasks = weekTasks.filter((item) => item.status === "Готово").length;
  const workTotal = activeWeekly.length + weekTasks.length;
  const completion = workTotal ? Math.round(((doneWeekly + doneTasks) / workTotal) * 100) : 0;

  const filteredRoutines = useMemo(() => {
    const normalized = query.toLocaleLowerCase("ru");
    return routines.filter((item) => {
      const textMatch = `${item.title} ${item.block} ${item.owner}`.toLocaleLowerCase("ru").includes(normalized);
      const freqMatch = frequency === "Все" || item.frequency === frequency;
      const ownerMatch = ownerFilter === "Все" || item.owner === ownerFilter;
      return textMatch && freqMatch && ownerMatch;
    });
  }, [routines, query, frequency, ownerFilter]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  };

  const openCreate = () => {
    setModalMode("create");
    setEditing(emptyRoutine(team, categories));
  };

  const openCreateTask = (date = monday) => {
    setTaskModalMode("create");
    setEditingTask(emptyTask(team, categories, date));
  };

  const openEditTask = (task: Task) => {
    setTaskModalMode("edit");
    setEditingTask({ ...task });
  };

  const openEdit = (item: Routine) => {
    setModalMode("edit");
    setEditing({ ...item, days: [...item.days] });
  };

  const saveRoutine = (event: FormEvent) => {
    event.preventDefault();
    if (!editing?.title.trim()) return;
    const normalized: Routine = {
      ...editing,
      id: editing.id || `custom-${Date.now()}`,
      when:
        editing.frequency === "Еженедельно"
          ? editing.days[0] ?? "Понедельник"
          : editing.frequency === "Ежедневно"
            ? "Пн–Пт"
            : editing.when,
      days:
        editing.frequency === "Еженедельно"
          ? [editing.days[0] ?? "Понедельник"]
          : editing.frequency === "Ежедневно"
            ? settings.workdays
            : [],
    };
    setRoutines((current) =>
      modalMode === "create"
        ? [...current, normalized]
        : current.map((item) => (item.id === normalized.id ? normalized : item)),
    );
    setEditing(null);
    flash(modalMode === "create" ? "Рутина добавлена" : "Изменения сохранены");
  };

  const deleteRoutine = () => {
    if (!editing) return;
    setRoutines((current) => current.filter((item) => item.id !== editing.id));
    setCompleted((current) => current.filter((id) => !id.startsWith(`${editing.id}:`)));
    setEditing(null);
    flash("Рутина удалена");
  };

  const saveTask = (event: FormEvent) => {
    event.preventDefault();
    if (!editingTask?.title.trim()) return;
    const normalized: Task = {
      ...editingTask,
      id: editingTask.id || `task-${Date.now()}`,
      title: editingTask.title.trim(),
    };
    setTasks((current) =>
      taskModalMode === "create"
        ? [...current, normalized]
        : current.map((item) => (item.id === normalized.id ? normalized : item)),
    );
    setEditingTask(null);
    flash(taskModalMode === "create" ? "Задача добавлена" : "Задача обновлена");
  };

  const deleteTask = () => {
    if (!editingTask) return;
    setTasks((current) => current.filter((item) => item.id !== editingTask.id));
    setEditingTask(null);
    flash("Задача удалена");
  };

  const moveRoutine = (day: string) => {
    if (draggedId) {
      setRoutines((current) =>
        current.map((item) =>
          item.id === draggedId && item.frequency === "Еженедельно"
            ? { ...item, days: [day], when: day }
            : item,
        ),
      );
      setDraggedId(null);
      flash(`Рутина перенесена на ${day.toLocaleLowerCase("ru")}`);
    }
  };

  const moveTask = (date: Date, day: string) => {
    if (!draggedTaskId) return;
    setTasks((current) => current.map((item) => item.id === draggedTaskId ? { ...item, date: dateKey(date) } : item));
    setDraggedTaskId(null);
    flash(`Задача перенесена на ${day.toLocaleLowerCase("ru")}`);
  };

  const resetAll = () => {
    setRoutines(defaultRoutines);
    setTasks([]);
    setKpis(defaultKpis);
    setSettings(defaultSettings);
    setCompleted([]);
    setTeam(initialTeam);
    setCategories(seedBlocks);
    flash("Исходная система восстановлена");
  };

  return (
    <main className={`routines-module ${settings.compact ? "compact" : ""}`}>
      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow"><span className="live-dot" /> {syncState}</div>
            <h1>{tab === "week" ? "Операционная неделя" : tab === "routines" ? "Каталог рутин" : tab === "metrics" ? "Показатели месяца" : "Настройки системы"}</h1>
          </div>
          <div className="top-actions">
            <nav className="routines-tabs" aria-label="Разделы рутин">
              {nav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
            </nav>
            {tab === "week" && <button className="task-button" onClick={() => openCreateTask()}><span>＋</span> Добавить задачу</button>}
            <button className="primary-button" onClick={openCreate}><span>＋</span> Добавить рутину</button>
          </div>
        </header>

        {tab === "week" && (
          <div className="page-content week-view">
            <section className="week-toolbar">
              <div className="week-switcher">
                <button onClick={() => setWeekOffset((value) => value - 1)} aria-label="Предыдущая неделя">‹</button>
                <div><strong>{formatRange(monday)}</strong><small>Неделя {getWeekNumber(monday)}</small></div>
                <button onClick={() => setWeekOffset((value) => value + 1)} aria-label="Следующая неделя">›</button>
                {weekOffset !== 0 && <button className="today-button" onClick={() => setWeekOffset(0)}>Сегодня</button>}
              </div>
              <div className="week-summary">
                <div className="ring" style={{ "--value": `${completion * 3.6}deg` } as React.CSSProperties}><span>{completion}%</span></div>
                <div><strong>{doneWeekly + doneTasks} из {workTotal}</strong><small>рутин и задач выполнено</small></div>
              </div>
            </section>

            {settings.showDaily && (
              <section className="daily-routines">
                <div className="section-heading">
                  <div><span className="pulse-mark">✦</span><div><strong>Ежедневные рутины</strong><small>Выполняются каждый рабочий день</small></div></div>
                  <button onClick={() => { setTab("routines"); setFrequency("Ежедневно"); }}>Настроить <span>→</span></button>
                </div>
                <div className="daily-list">
                  {daily.map((item) => (
                    <button key={item.id} className="daily-chip" onClick={() => openEdit(item)}>
                      <span className={`mini-dot ${blockColors[item.block] ?? "violet"}`} />
                      <time>{item.time.startsWith("До ") ? item.time.slice(3) : item.time.split(" ")[0]}</time>
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="week-board" aria-label="Недельный календарь" style={{ gridTemplateColumns: `repeat(${Math.max(settings.workdays.length, 1)}, minmax(0, 1fr))` }}>
              {settings.workdays.map((day, index) => {
                const date = addDays(monday, index);
                const isToday = date.toDateString() === new Date().toDateString();
                const dayRoutines = activeWeekly
                  .filter((item) => item.days.includes(day))
                  .sort((a, b) => a.time.localeCompare(b.time));
                const dayTasks = tasks
                  .filter((item) => item.date === dateKey(date))
                  .sort((a, b) => a.time.localeCompare(b.time));
                return (
                  <div
                    className={`day-column ${isToday ? "today" : ""}`}
                    key={day}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => draggedTaskId ? moveTask(date, day) : moveRoutine(day)}
                  >
                    <header>
                      <div><span>{dayShort[day]}</span><strong>{date.getDate()}</strong></div>
                      <em>{dayRoutines.length + dayTasks.length}</em>
                    </header>
                    <div className="day-body">
                      {dayRoutines.map((item) => (
                        <RoutineCard
                          key={item.id}
                          item={item}
                          done={completed.includes(completionKey(item.id))}
                          onToggle={() => setCompleted((current) => current.includes(completionKey(item.id)) ? current.filter((id) => id !== completionKey(item.id)) : [...current, completionKey(item.id)])}
                          onEdit={() => openEdit(item)}
                          onDragStart={() => { setDraggedTaskId(null); setDraggedId(item.id); }}
                        />
                      ))}
                      {dayTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onToggle={() => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: item.status === "Готово" ? "К выполнению" : "Готово" } : item))}
                          onEdit={() => openEditTask(task)}
                          onDragStart={() => { setDraggedId(null); setDraggedTaskId(task.id); }}
                        />
                      ))}
                      <div className="day-add-row">
                        <button className="day-add" onClick={() => {
                          const blank = emptyRoutine(team, categories);
                          blank.days = [day];
                          blank.when = day;
                          setModalMode("create");
                          setEditing(blank);
                        }}>＋ Рутина</button>
                        <button className="day-add task-add" onClick={() => openCreateTask(date)}>＋ Задача</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
            <p className="board-hint"><span>↕</span> Перетаскивайте рутины и задачи между днями — изменения сохранятся автоматически.</p>
          </div>
        )}

        {tab === "routines" && (
          <div className="page-content routines-view">
            <section className="stats-row">
              <SummaryCard label="Всего рутин" value={routines.length} note="в системе" tone="violet" />
              <SummaryCard label="Ежедневные" value={routines.filter((item) => item.frequency === "Ежедневно").length} note="по будням" tone="blue" />
              <SummaryCard label="Еженедельные" value={routines.filter((item) => item.frequency === "Еженедельно").length} note="в календаре" tone="pink" />
              <SummaryCard label="Ежемесячные" value={routines.filter((item) => item.frequency === "Ежемесячно").length} note="контрольных" tone="green" />
            </section>
            <section className="catalog-panel">
              <div className="catalog-filters">
                <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти рутину, блок или ответственного" /></label>
                <select value={frequency} onChange={(event) => setFrequency(event.target.value as "Все" | Frequency)}>
                  <option>Все</option><option>Ежедневно</option><option>Еженедельно</option><option>Ежемесячно</option>
                </select>
                <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                  <option>Все</option>{team.map((person) => <option key={person}>{person}</option>)}
                </select>
              </div>
              <div className="routine-table">
                <div className="table-head"><span>Рутина</span><span>Периодичность</span><span>Ответственный</span><span>Время</span><span>Статус</span><span /></div>
                {filteredRoutines.map((item) => (
                  <div className={`table-row ${item.status === "На паузе" ? "paused" : ""}`} key={item.id}>
                    <div className="routine-title"><span className={`block-icon ${blockColors[item.block] ?? "violet"}`}>{item.block.slice(0, 1)}</span><div><strong>{item.title}</strong><small>{item.block} · {item.result || "Результат не задан"}</small></div></div>
                    <span><b className="frequency-pill">{item.frequency}</b><small>{item.when}</small></span>
                    <span><strong>{item.owner}</strong><small>{item.participants}</small></span>
                    <span><strong>{item.time}</strong><small>{item.duration}</small></span>
                    <button className={`status-toggle ${item.status === "Активна" ? "on" : ""}`} onClick={() => setRoutines((current) => current.map((routine) => routine.id === item.id ? { ...routine, status: routine.status === "Активна" ? "На паузе" : "Активна" } : routine))}><i /> {item.status}</button>
                    <button className="more-button" onClick={() => openEdit(item)}>•••</button>
                  </div>
                ))}
                {!filteredRoutines.length && <div className="empty-state">По этим фильтрам ничего не найдено.</div>}
              </div>
            </section>
          </div>
        )}

        {tab === "metrics" && (
          <div className="page-content metrics-view">
            <div className="metrics-intro"><div><strong>План-факт · Август 2026</strong><p>Меняйте план и факт прямо в карточках. Статус рассчитывается автоматически.</p></div><span>Последнее обновление: сегодня</span></div>
            <section className="kpi-grid">
              {kpis.map((kpi) => {
                const progress = progressFor(kpi);
                return (
                  <article className="kpi-card" key={kpi.id}>
                    <div className="kpi-top"><span className={progress >= 80 ? "good" : progress >= 45 ? "warn" : "bad"}>{progress >= 100 ? "Выполнено" : progress >= 70 ? "В графике" : "Требует внимания"}</span><em>{progress}%</em></div>
                    <h3>{kpi.label}</h3>
                    <div className="kpi-inputs">
                      <label><small>Факт</small><input type="number" value={kpi.fact} onChange={(event) => setKpis((current) => current.map((item) => item.id === kpi.id ? { ...item, fact: Number(event.target.value) } : item))} /></label>
                      <span>/</span>
                      <label><small>План</small><input type="number" value={kpi.plan} onChange={(event) => setKpis((current) => current.map((item) => item.id === kpi.id ? { ...item, plan: Number(event.target.value) } : item))} /></label>
                    </div>
                    <div className="kpi-bar"><i className={progress >= 80 ? "good" : progress >= 45 ? "warn" : "bad"} style={{ width: `${progress}%` }} /></div>
                  </article>
                );
              })}
            </section>
            <section className="focus-panel"><span>Главный фокус месяца</span><h3>35 новых SMB-клиентов и 3 Enterprise / Pharma</h3><p>Контент и продуктовые ритмы подчинены одному результату: стабильный поток клиентов и масштабируемая система подключения.</p></section>
          </div>
        )}

        {tab === "settings" && (
          <div className="page-content settings-view">
            <div className="settings-grid">
              <section className="settings-card">
                <div className="settings-heading"><span>01</span><div><strong>Основные параметры</strong><small>Название и рабочий ритм</small></div></div>
                <label>Название системы<input value={settings.projectName} onChange={(event) => setSettings({ ...settings, projectName: event.target.value })} /></label>
                <div className="field-row"><label>Ежедневная планёрка<input type="time" value={settings.standupTime} onChange={(event) => setSettings({ ...settings, standupTime: event.target.value })} /></label><label>Закрытие дня<input type="time" value={settings.dayCloseTime} onChange={(event) => setSettings({ ...settings, dayCloseTime: event.target.value })} /></label></div>
                <label>Рабочие дни</label>
                <div className="day-select">{Object.keys(dayShort).map((day) => <button key={day} className={settings.workdays.includes(day) ? "selected" : ""} onClick={() => setSettings({ ...settings, workdays: settings.workdays.includes(day) ? settings.workdays.filter((item) => item !== day) : Object.keys(dayShort).filter((item) => [...settings.workdays, day].includes(item)) })}>{dayShort[day]}</button>)}</div>
              </section>

              <section className="settings-card">
                <div className="settings-heading"><span>02</span><div><strong>Отображение</strong><small>Как выглядит рабочая неделя</small></div></div>
                <Toggle label="Показывать ежедневные рутины" note="Закреплённый блок над календарём" checked={settings.showDaily} onChange={(value) => setSettings({ ...settings, showDaily: value })} />
                <Toggle label="Компактный режим" note="Больше карточек помещается на экране" checked={settings.compact} onChange={(value) => setSettings({ ...settings, compact: value })} />
              </section>

              <section className="settings-card">
                <div className="settings-heading"><span>03</span><div><strong>Команда</strong><small>Ответственные в карточках рутин</small></div></div>
                <div className="tag-list">{team.map((person) => <span key={person}>{person}<button onClick={() => setTeam((current) => current.filter((item) => item !== person))}>×</button></span>)}</div>
                <form className="inline-add" onSubmit={(event) => { event.preventDefault(); if (newOwner.trim() && !team.includes(newOwner.trim())) setTeam([...team, newOwner.trim()]); setNewOwner(""); }}><input value={newOwner} onChange={(event) => setNewOwner(event.target.value)} placeholder="Новая роль или сотрудник" /><button>Добавить</button></form>
              </section>

              <section className="settings-card">
                <div className="settings-heading"><span>04</span><div><strong>Тематические блоки</strong><small>Категории для группировки</small></div></div>
                <div className="tag-list categories">{categories.map((category) => <span key={category}><i className={blockColors[category] ?? "violet"} />{category}<button onClick={() => setCategories((current) => current.filter((item) => item !== category))}>×</button></span>)}</div>
                <form className="inline-add" onSubmit={(event) => { event.preventDefault(); if (newCategory.trim() && !categories.includes(newCategory.trim())) setCategories([...categories, newCategory.trim()]); setNewCategory(""); }}><input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Новый блок" /><button>Добавить</button></form>
              </section>
            </div>
            <section className="danger-card"><div><strong>Восстановить исходную систему</strong><p>Вернёт рутины, KPI, команду и настройки к первоначальной версии из Excel и удалит добавленные задачи.</p></div><button onClick={resetAll}>Сбросить изменения</button></section>
          </div>
        )}
      </section>

      {editing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <form className="routine-modal" onSubmit={saveRoutine}>
            <header><div><span>{modalMode === "create" ? "НОВАЯ РУТИНА" : "РЕДАКТИРОВАНИЕ"}</span><h2>{modalMode === "create" ? "Добавить рутину" : "Настроить рутину"}</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
            <div className="modal-body">
              <label className="wide">Название рутины<textarea value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} required rows={2} /></label>
              <label>Периодичность<select value={editing.frequency} onChange={(event) => setEditing({ ...editing, frequency: event.target.value as Frequency })}><option>Ежедневно</option><option>Еженедельно</option><option>Ежемесячно</option></select></label>
              {editing.frequency === "Еженедельно" ? <label>День недели<select value={editing.days[0] ?? "Понедельник"} onChange={(event) => setEditing({ ...editing, days: [event.target.value], when: event.target.value })}>{Object.keys(dayShort).map((day) => <option key={day}>{day}</option>)}</select></label> : editing.frequency === "Ежемесячно" ? <label>Когда<input value={editing.when} onChange={(event) => setEditing({ ...editing, when: event.target.value })} placeholder="Например, последняя неделя" /></label> : <label>Когда<input value="Пн–Пт" disabled /></label>}
              <label>Тематический блок<select value={editing.block} onChange={(event) => setEditing({ ...editing, block: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Ответственный<select value={editing.owner} onChange={(event) => setEditing({ ...editing, owner: event.target.value })}>{team.map((person) => <option key={person}>{person}</option>)}</select></label>
              <label>Время / дедлайн<input value={editing.time} onChange={(event) => setEditing({ ...editing, time: event.target.value })} /></label>
              <label>Длительность<input value={editing.duration} onChange={(event) => setEditing({ ...editing, duration: event.target.value })} /></label>
              <label className="wide">Результат / артефакт<input value={editing.result} onChange={(event) => setEditing({ ...editing, result: event.target.value })} /></label>
              <label>Метрика<input value={editing.metric} onChange={(event) => setEditing({ ...editing, metric: event.target.value })} /></label>
              <label>Цель / SLA<input value={editing.target} onChange={(event) => setEditing({ ...editing, target: event.target.value })} /></label>
              <label className="wide">Участники<input value={editing.participants} onChange={(event) => setEditing({ ...editing, participants: event.target.value })} /></label>
            </div>
            <footer>{modalMode === "edit" ? <button type="button" className="delete-button" onClick={deleteRoutine}>Удалить</button> : <span />}<div><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Отмена</button><button className="primary-button">Сохранить</button></div></footer>
          </form>
        </div>
      )}
      {editingTask && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingTask(null); }}>
          <form className="routine-modal task-modal" onSubmit={saveTask}>
            <header><div><span>{taskModalMode === "create" ? "НОВАЯ ЗАДАЧА" : "РЕДАКТИРОВАНИЕ"}</span><h2>{taskModalMode === "create" ? "Добавить задачу" : "Настроить задачу"}</h2></div><button type="button" onClick={() => setEditingTask(null)}>×</button></header>
            <div className="modal-body">
              <label className="wide">Что нужно сделать<textarea value={editingTask.title} onChange={(event) => setEditingTask({ ...editingTask, title: event.target.value })} required rows={2} placeholder="Например, подготовить КП для клиента" /></label>
              <label>День<select value={editingTask.date} onChange={(event) => setEditingTask({ ...editingTask, date: event.target.value })}>{settings.workdays.map((day, index) => { const date = addDays(monday, index); return <option key={day} value={dateKey(date)}>{day}, {date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</option>; })}</select></label>
              <label>Статус<select value={editingTask.status} onChange={(event) => setEditingTask({ ...editingTask, status: event.target.value as TaskStatus })}><option>К выполнению</option><option>В работе</option><option>Готово</option></select></label>
              <label>Тематический блок<select value={editingTask.block} onChange={(event) => setEditingTask({ ...editingTask, block: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Ответственный<select value={editingTask.owner} onChange={(event) => setEditingTask({ ...editingTask, owner: event.target.value })}>{team.map((person) => <option key={person}>{person}</option>)}</select></label>
              <label>Дедлайн<input type="time" value={editingTask.time} onChange={(event) => setEditingTask({ ...editingTask, time: event.target.value })} /></label>
              <label>Участники / соисполнители<input value={editingTask.participants} onChange={(event) => setEditingTask({ ...editingTask, participants: event.target.value })} /></label>
              <label className="wide">Комментарий<textarea value={editingTask.notes} onChange={(event) => setEditingTask({ ...editingTask, notes: event.target.value })} rows={3} placeholder="Контекст, критерий готовности или ссылка" /></label>
            </div>
            <footer>{taskModalMode === "edit" ? <button type="button" className="delete-button" onClick={deleteTask}>Удалить</button> : <span />}<div><button type="button" className="secondary-button" onClick={() => setEditingTask(null)}>Отмена</button><button className="primary-button">Сохранить задачу</button></div></footer>
          </form>
        </div>
      )}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function RoutineCard({ item, done, onToggle, onEdit, onDragStart }: { item: Routine; done: boolean; onToggle: () => void; onEdit: () => void; onDragStart: () => void }) {
  return (
    <article className={`routine-card ${done ? "done" : ""}`} draggable onDragStart={onDragStart}>
      <div className="card-top"><span className={`block-label ${blockColors[item.block] ?? "violet"}`}>{item.block}</span><button onClick={onEdit} aria-label="Редактировать">•••</button></div>
      <button className="card-title" onClick={onEdit}>{item.title}</button>
      <div className="card-meta"><span>◷ {item.time}</span><span>{item.duration}</span></div>
      <div className="card-footer"><span className="avatar">{initials(item.owner)}</span><small>{item.owner}</small><button className="check-button" onClick={onToggle} aria-label={done ? "Отметить невыполненной" : "Отметить выполненной"}>{done ? "✓" : ""}</button></div>
    </article>
  );
}

function TaskCard({ task, onToggle, onEdit, onDragStart }: { task: Task; onToggle: () => void; onEdit: () => void; onDragStart: () => void }) {
  const done = task.status === "Готово";
  return (
    <article className={`routine-card task-card ${done ? "done" : ""}`} draggable onDragStart={onDragStart}>
      <div className="card-top"><div className="task-labels"><span className="task-type">Задача</span><span className={`block-label ${blockColors[task.block] ?? "violet"}`}>{task.block}</span></div><button onClick={onEdit} aria-label="Редактировать задачу">•••</button></div>
      <button className="card-title" onClick={onEdit}>{task.title}</button>
      <div className="card-meta"><span>◷ {task.time}</span><span className={`task-status status-${task.status === "В работе" ? "doing" : done ? "done" : "todo"}`}>{task.status}</span></div>
      <div className="card-footer"><span className="avatar">{initials(task.owner)}</span><small>{task.owner}</small><button className="check-button" onClick={onToggle} aria-label={done ? "Вернуть задачу в работу" : "Отметить задачу выполненной"}>{done ? "✓" : ""}</button></div>
    </article>
  );
}

function SummaryCard({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className="summary-card"><span className={tone}>✦</span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></article>;
}

function Toggle({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button className="toggle-row" onClick={() => onChange(!checked)}><div><strong>{label}</strong><small>{note}</small></div><span className={checked ? "on" : ""}><i /></span></button>;
}

function initials(value: string) {
  return value.split(/\s|\+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function getWeekNumber(date: Date) {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  return Math.ceil((((current.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
