import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { createServerAuthClient } from "@/lib/supabase/auth";
import { getCrmStateAsync } from "@/lib/crm/store";
import { recordSecurityAuditSafe } from "@/lib/security/audit";

const passwordSchema = z.string()
  .min(10, "Пароль должен содержать минимум 10 символов.")
  .max(128)
  .regex(/[a-zа-я]/i, "Добавьте буквы.")
  .regex(/\d/, "Добавьте цифру.");
const schema = z.object({ password: passwordSchema });

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Ссылка недействительна или сессия закончилась." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте пароль." }, { status: 400 });

  const auth = await createServerAuthClient();
  const { error } = await auth.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const user = (await getCrmStateAsync()).users.find((item) => item.id === userId);
  if (user) await recordSecurityAuditSafe(user, "auth.password_changed", "crm_user", user.id);
  await auth.auth.signOut({ scope: "global" });
  return NextResponse.json({ ok: true, message: "Пароль изменен. Войдите заново." });
}
