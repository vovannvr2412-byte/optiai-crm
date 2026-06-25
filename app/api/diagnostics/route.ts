import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { getCrmStateAsync } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET() {
  const env = {
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasAuthSecret: Boolean(process.env.AUTH_SECRET),
    authCookieSecure: process.env.AUTH_COOKIE_SECURE ?? null,
    nodeEnv: process.env.NODE_ENV ?? null
  };

  const result: Record<string, unknown> = { env };

  try {
    const supabase = createServiceSupabaseClient();
    const read = await supabase.from("crm_app_state").select("key").limit(5);
    result.supabaseRead = read.error ? { ok: false, message: read.error.message, code: read.error.code } : { ok: true, rows: read.data?.length ?? 0 };

    const write = await supabase.from("crm_app_state").upsert({
      key: "diagnostics",
      value: { checkedAt: new Date().toISOString() },
      updated_at: new Date().toISOString()
    }, { onConflict: "key" });
    result.supabaseWrite = write.error ? { ok: false, message: write.error.message, code: write.error.code } : { ok: true };
  } catch (error) {
    result.supabaseClient = { ok: false, message: errorText(error) };
  }

  try {
    const state = await getCrmStateAsync();
    result.crmState = {
      ok: true,
      users: state.users.length,
      leads: state.leads.length,
      ownerExists: state.users.some((user) => user.email === "owner@optiai.ru" && user.status === "active"),
      ropExists: state.users.some((user) => user.email === "rop@optiai.ru" && user.status === "active")
    };
  } catch (error) {
    result.crmState = { ok: false, message: errorText(error) };
  }

  return NextResponse.json(result);
}
