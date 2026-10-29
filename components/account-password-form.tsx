"use client";

import { FormEvent, useState } from "react";

export function AccountPasswordForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel?: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setMessage("Пароли не совпадают.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!response.ok) {
        setMessage(data?.error ?? "Не удалось изменить пароль.");
        return;
      }
      setMessage(data?.message ?? "Пароль изменен.");
      window.setTimeout(onSuccess, 700);
    } catch {
      setMessage("Сервер недоступен. Пароль не изменен.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h2 className="pr-12 text-xl font-bold text-[#202939]">Новый пароль</h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">Минимум 8 символов, включая буквы и цифры. После сохранения потребуется войти заново.</p>
      </div>
      <label className="ui-label">Пароль<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={8} maxLength={128} required className="ui-field" /></label>
      <label className="ui-label">Повторите пароль<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} type="password" autoComplete="new-password" minLength={8} maxLength={128} required className="ui-field" /></label>
      {message && <div role="status" className="rounded-lg border border-[#DCE2EA] bg-slate-50 p-3 text-sm text-slate-700">{message}</div>}
      <div className="flex flex-wrap gap-2">
        <button disabled={submitting} className="ui-button ui-button-primary">{submitting ? "Сохраняем..." : "Сменить пароль"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="ui-button ui-button-secondary">Отмена</button>}
      </div>
    </form>
  );
}
