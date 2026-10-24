import { NextResponse } from "next/server";
import { z } from "zod";
import { passwordSetupUrl } from "@/lib/auth/urls";
import { createServerAuthClient, supabaseAuthEnabled } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.string().trim().email() });
const genericMessage = "Если активный аккаунт с таким email существует, письмо для восстановления уже отправлено.";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Введите корректный email." }, { status: 400 });
  if (!supabaseAuthEnabled()) return NextResponse.json({ error: "Восстановление пароля требует Supabase Auth." }, { status: 503 });

  const normalizedEmail = parsed.data.email.toLowerCase();
  const { data: crmUser, error: crmError } = await createServiceSupabaseClient()
    .from("crm_users")
    .select("id")
    .eq("email", normalizedEmail)
    .eq("status", "active")
    .maybeSingle();
  if (crmError) console.error("Password reset CRM lookup failed", { message: crmError.message });
  if (crmUser) {
    const auth = await createServerAuthClient();
    const { error } = await auth.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: passwordSetupUrl(request)
    });
    if (error) console.error("Password reset request failed", { message: error.message });
  }
  return NextResponse.json({ message: genericMessage });
}
