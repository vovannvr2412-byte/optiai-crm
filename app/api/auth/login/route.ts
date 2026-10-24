import { NextResponse } from "next/server";
import { z } from "zod";
import { disableCredential, ensureCredentials, verifyCredential } from "@/lib/auth/credentials";
import { linkAuthenticatedUser, markCrmUserLogin, provisionSupabaseAuthUser } from "@/lib/auth/supabase-users";
import { setSession } from "@/lib/auth/session";
import { createServerAuthClient, supabaseAuthEnabled } from "@/lib/supabase/auth";
import { getCrmStateAsync, persistCredentialsAsync } from "@/lib/crm/store";
import { recordSecurityAuditSafe } from "@/lib/security/audit";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Введите корректный email и пароль" }, { status: 400 });
  }

  if (supabaseAuthEnabled()) return loginWithSupabase(parsed.data.email, parsed.data.password);

  let state;
  try {
    state = await getCrmStateAsync();
    ensureCredentials(state.users);
    await persistCredentialsAsync();
  } catch {
    return NextResponse.json({ error: "CRM не подключилась к Supabase. Проверьте таблицу crm_app_state и переменные Vercel." }, { status: 500 });
  }
  const userId = verifyCredential(parsed.data.email, parsed.data.password);
  const user = userId ? state.users.find((item) => item.id === userId && item.status === "active") : null;
  if (!user) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  await setSession(user.id);
  return NextResponse.json({ user });
}

async function loginWithSupabase(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const state = await getCrmStateAsync();
    const crmUser = state.users.find((item) => item.email.toLowerCase() === normalizedEmail && item.status === "active");
    if (!crmUser) return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });

    const auth = await createServerAuthClient();
    let result = await auth.auth.signInWithPassword({ email: normalizedEmail, password });

    if (result.error || !result.data.user) {
      const legacyUserId = verifyCredential(normalizedEmail, password);
      if (!legacyUserId) {
        return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
      }
      await provisionSupabaseAuthUser(crmUser, password);
      disableCredential(normalizedEmail);
      await persistCredentialsAsync();
      result = await auth.auth.signInWithPassword({ email: normalizedEmail, password });
    }

    if (result.error || !result.data.user) {
      return NextResponse.json({ error: "Не удалось создать сессию Supabase Auth" }, { status: 401 });
    }

    await linkAuthenticatedUser(crmUser, result.data.user);
    await markCrmUserLogin(crmUser.id);
    await recordSecurityAuditSafe(crmUser, "auth.login", "crm_user", crmUser.id);
    return NextResponse.json({ user: crmUser }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Supabase Auth login failed", { message, error });
    return NextResponse.json({ error: `Не удалось войти: ${message}` }, { status: 500 });
  }
}
