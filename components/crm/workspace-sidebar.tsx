"use client";

import Link from "next/link";
import clsx from "clsx";
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckSquare2,
  Flame,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  PhoneCall,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import { VIEW_TITLES, type CrmUser, type ViewId } from "@/lib/crm/types";
import { OptiaiLogo } from "@/components/brand/optiai-logo";

const navigation: { id: ViewId; icon: typeof LayoutDashboard }[] = [
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

type WorkspaceSidebarProps = {
  moduleTitle: string;
  currentUser: CrmUser;
  allowedViews: ViewId[];
  activeView: ViewId;
  loggingOut: boolean;
  onNavigate: (view: ViewId) => void;
  onChangePassword: () => void;
  onLogout: () => void;
};

export function WorkspaceSidebar({
  moduleTitle,
  currentUser,
  allowedViews,
  activeView,
  loggingOut,
  onNavigate,
  onChangePassword,
  onLogout
}: WorkspaceSidebarProps) {
  return (
    <aside className="crm-sidebar">
      <div className="crm-sidebar-brand">
        <Link href="/" className="crm-home-link" aria-label="К приложениям" title="К приложениям">
          <ArrowLeft size={17} />
        </Link>
        <div className="crm-sidebar-brand-copy">
          <OptiaiLogo compact />
          <span>{moduleTitle}</span>
        </div>
      </div>

      <p className="crm-nav-label">Рабочие разделы</p>
      <nav className="crm-nav" aria-label="Основная навигация">
        {navigation
          .filter((item) => allowedViews.includes(item.id))
          .map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              className={clsx("crm-nav-item", activeView === id && "crm-nav-item-active")}
              aria-current={activeView === id ? "page" : undefined}
              title={VIEW_TITLES[id]}
            >
              <Icon size={18} />
              <span>{VIEW_TITLES[id]}</span>
            </button>
          ))}
      </nav>

      <div className="crm-account-footer">
        <div className="crm-account-summary">
          <span className="crm-account-avatar" aria-hidden>{initials(currentUser.fullName)}</span>
          <div>
            <strong>{currentUser.fullName}</strong>
            <span>{currentUser.role}</span>
          </div>
        </div>
        <div className="crm-account-actions">
          <button type="button" onClick={onChangePassword} className="crm-account-action" aria-label="Сменить пароль" title="Сменить пароль">
            <KeyRound size={17} /> <span>Сменить пароль</span>
          </button>
          <button type="button" onClick={onLogout} disabled={loggingOut} className="crm-account-action" aria-label="Выйти из аккаунта" title="Выйти">
            <LogOut size={17} /> <span>{loggingOut ? "Выходим..." : "Выйти"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
