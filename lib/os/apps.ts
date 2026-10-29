import type { CrmUser, OsAppId, Role } from "@/lib/crm/types";

export type OsAppDefinition = {
  id: OsAppId;
  title: string;
  description: string;
  href: string;
};

export const OS_APPS: OsAppDefinition[] = [
  { id: "leads", title: "Лиды CRM", description: "Воронка, задачи, коммуникации и прогрев", href: "/apps/leads" },
  { id: "management", title: "Панель управления", description: "Клиенты, подписки, оплаты и документы", href: "/apps/management" },
  { id: "content", title: "Контент", description: "Планирование и производство материалов", href: "/apps/content" },
  { id: "routines", title: "Рутины", description: "Операционная неделя, процессы и KPI", href: "/apps/routines" },
  { id: "settings", title: "Настройки", description: "API, мессенджеры, SIP и автоматизации", href: "/apps/settings" },
  { id: "team", title: "Команда", description: "Пользователи, роли и разрешения", href: "/apps/team" }
];

const defaultAccess: Record<Role, OsAppId[]> = {
  "Руководитель": ["leads", "management", "content", "routines", "settings", "team"],
  "Менеджер по продажам": ["leads"],
  "Технический специалист": ["leads", "settings"]
};

const accessCeiling: Record<Role, OsAppId[]> = {
  "Руководитель": ["leads", "management", "content", "routines", "settings", "team"],
  "Менеджер по продажам": ["leads", "content", "routines"],
  "Технический специалист": ["leads", "content", "routines", "settings"]
};

export function configurableAppsFor(role: Role) {
  return OS_APPS.filter((app) => accessCeiling[role].includes(app.id));
}

export function appAccessFor(user: Pick<CrmUser, "role" | "appPermissions">) {
  if (user.role === "Руководитель") return defaultAccess[user.role];
  const allowed = new Set(accessCeiling[user.role]);
  return [...new Set([...defaultAccess[user.role], ...(user.appPermissions ?? [])])].filter((app) => allowed.has(app));
}

export function canAccessApp(user: Pick<CrmUser, "role" | "appPermissions">, app: OsAppId) {
  return appAccessFor(user).includes(app);
}
