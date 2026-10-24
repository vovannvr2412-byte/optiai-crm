import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const configuredToken = process.env.DIAGNOSTICS_TOKEN?.trim();
    const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const tokenAccepted = Boolean(configuredToken && suppliedToken === configuredToken);
    if (!tokenAccepted) {
      const userId = await getSessionUserId();
      const user = userId ? (await getCrmStateAsync()).users.find((item) => item.id === userId) : null;
      if (!user || user.role !== "Руководитель") {
        return NextResponse.json({ error: "Диагностика доступна только руководителю." }, { status: 401 });
      }
    }
  }
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
    const read = await supabase.from("crm_app_state").select("key").limit(10);
    result.supabaseRead = read.error ? { ok: false, message: read.error.message, code: read.error.code } : { ok: true, rows: read.data?.length ?? 0 };
    const [marker, users, leads] = await Promise.all([
      supabase.from("crm_app_state").select("updated_at").eq("key", "normalized_storage_v1").maybeSingle(),
      supabase.from("crm_users").select("id", { count: "exact", head: true }),
      supabase.from("leads").select("id", { count: "exact", head: true })
    ]);
    result.normalizedStorage = marker.error
      ? { ok: false, message: marker.error.message }
      : { ok: Boolean(marker.data), migratedAt: marker.data?.updated_at ?? null };
    result.normalizedTables = {
      users: users.error ? null : users.count,
      leads: leads.error ? null : leads.count
    };
  } catch (error) {
    result.supabaseClient = { ok: false, message: errorText(error) };
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
