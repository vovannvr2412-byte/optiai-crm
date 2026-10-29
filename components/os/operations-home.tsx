"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarRange,
  Eye,
  EyeOff,
  FileStack,
  LogOut,
  Settings2,
  UsersRound
} from "lucide-react";
import { OS_APPS, appAccessFor } from "@/lib/os/apps";
import type { CrmUser, OsAppId } from "@/lib/crm/types";
import { readApiJson, readApiJsonOrNull } from "@/lib/api/client";
import { OptiaiLogo } from "@/components/brand/optiai-logo";

type Bootstrap = { currentUser: CrmUser };

const appIcons: Record<OsAppId, typeof BriefcaseBusiness> = {
  leads: BriefcaseBusiness,
  management: BarChart3,
  content: FileStack,
  routines: CalendarRange,
  settings: Settings2,
  team: UsersRound
};

export function OperationsHome() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/crm/bootstrap", { cache: "no-store" });
      if (response.status === 401) {
        setBootstrap(null);
        setChecked(true);
        return false;
      }
      const data = await readApiJson<Bootstrap>(response);
      setBootstrap(data);
      setChecked(true);
      return true;
    } catch {
      setBootstrap(null);
      setChecked(true);
      return false;
    }
  }, []);

  useEffect(() => {
    // Initial bootstrap synchronizes the external authenticated session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!checked) return <main className="os-loading">Загружаем рабочее пространство...</main>;
  if (!bootstrap) return <OsLogin onLogin={load} />;

  const available = new Set(appAccessFor(bootstrap.currentUser));
  const availableApps = OS_APPS.filter((app) => available.has(app.id));
  return (
    <main className="os-home">
      <header className="os-home-header">
        <OptiaiLogo />
        <div className="os-account">
          <div><strong>{bootstrap.currentUser.fullName}</strong><small>{bootstrap.currentUser.role}</small></div>
          <button
            type="button"
            title="Выйти"
            aria-label="Выйти из аккаунта"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              setBootstrap(null);
            }}
          ><LogOut size={18} /></button>
        </div>
      </header>

      <section className="os-launcher" aria-labelledby="workspace-title">
        <div className="os-launcher-heading">
          <p>Рабочее пространство</p>
          <h1 id="workspace-title">Приложения</h1>
          <span>Доступ определяется ролью и персональными разрешениями.</span>
        </div>
        <div className="os-app-grid" data-app-count={availableApps.length}>
          {availableApps.map((app) => {
            const Icon = appIcons[app.id];
            return (
              <Link href={{ pathname: app.href }} key={app.id} className="os-app-tile">
                <span className="os-app-icon"><Icon size={23} /></span>
                <span><strong>{app.title}</strong><small>{app.description}</small></span>
                <span className="os-app-arrow" aria-hidden>→</span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function OsLogin({ onLogin }: { onLogin: () => Promise<boolean> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = await readApiJsonOrNull<{ error?: string }>(response);
      if (!response.ok) throw new Error(body?.error || "Не удалось войти");
      if (!await onLogin()) throw new Error("Сессия создана, но профиль CRM не найден");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось войти");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const body = await readApiJsonOrNull<{ error?: string; message?: string }>(response);
      if (!response.ok) throw new Error(body?.error || "Не удалось отправить письмо");
      setNotice(body?.message || "Проверьте почту и папку «Спам».");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отправить письмо");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleResetMode() {
    setResetMode((value) => !value);
    setError("");
    setNotice("");
    setPassword("");
  }

  return (
    <main className="os-login-page">
      <section className="os-login-panel">
        <OptiaiLogo className="os-wordmark-dark" />
        <div className="os-login-copy">
          <h1>{resetMode ? "Восстановление пароля" : "Вход в рабочее пространство"}</h1>
          <p>{resetMode ? "Укажите рабочий email. Ссылка для нового пароля придёт на почту." : "Используйте корпоративный аккаунт, выданный руководителем."}</p>
        </div>
        <form onSubmit={resetMode ? requestReset : submit} className="os-login-form">
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
          {!resetMode && <label>Пароль<span className="os-password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>}
          {error && <p className="os-login-error">{error}</p>}
          {notice && <p className="os-login-success" role="status">{notice}</p>}
          <button className="os-login-submit" disabled={submitting}>
            {submitting ? (resetMode ? "Отправляем..." : "Входим...") : resetMode ? "Отправить ссылку" : "Войти"}
          </button>
          <button type="button" onClick={toggleResetMode} className="os-login-alternate">
            {resetMode ? "Вернуться ко входу" : "Забыли пароль?"}
          </button>
        </form>
      </section>
    </main>
  );
}
