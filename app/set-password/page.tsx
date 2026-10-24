"use client";

import { useEffect, useState } from "react";
import { AccountPasswordForm } from "@/components/account-password-form";
import { useRouter } from "next/navigation";
import { createBrowserAuthClient } from "@/lib/supabase/browser";

export default function SetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const auth = createBrowserAuthClient();
        const code = new URL(window.location.href).searchParams.get("code");
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (code) {
          const { error: exchangeError } = await auth.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          window.history.replaceState({}, "", "/set-password");
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await auth.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (sessionError) throw sessionError;
          window.history.replaceState({}, "", "/set-password");
        }
        const { data, error: userError } = await auth.auth.getUser();
        if (userError || !data.user) throw new Error("Ссылка недействительна или уже использована.");
        if (active) setReady(true);
      } catch (authError) {
        if (active) setError(authError instanceof Error ? authError.message : "Не удалось подтвердить ссылку.");
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#F5F7FA] p-4">
      <section className="w-[min(480px,100%)] rounded-lg border border-[#E5E7EB] bg-white p-8 shadow-[0_12px_28px_rgb(16_24_40/0.10)] max-sm:p-5">
        {!ready && !error && <p className="text-sm font-semibold text-slate-600">Проверяем защищенную ссылку...</p>}
        {error && <div role="alert" className="grid gap-3"><strong className="text-[#202939]">Не удалось открыть ссылку</strong><p className="text-sm text-rose-700">{error}</p><button onClick={() => router.replace("/")} className="ui-button ui-button-secondary">Вернуться ко входу</button></div>}
        {ready && <AccountPasswordForm onSuccess={() => router.replace("/")} />}
      </section>
    </main>
  );
}
