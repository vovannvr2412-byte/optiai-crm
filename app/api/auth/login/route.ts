import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureCredentials, verifyCredential } from "@/lib/auth/credentials";
import { setSession } from "@/lib/auth/session";
import { getCrmStateAsync, persistCredentialsAsync } from "@/lib/crm/store";

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
