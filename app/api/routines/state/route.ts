import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";
import { canAccessApp } from "@/lib/os/apps";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  state: z.record(z.string(), z.unknown()),
  expectedVersion: z.number().int().min(0)
});

async function authorizedUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  return user && canAccessApp(user, "routines") ? user : null;
}

export async function GET() {
  if (process.env.CRM_FORCE_LOCAL === "true") return NextResponse.json({ error: "Общее хранилище рутин доступно после подключения Supabase" }, { status: 503 });
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const { data, error } = await createServiceSupabaseClient()
    .from("routines_workspace")
    .select("state, version, updated_at")
    .eq("id", "default")
    .maybeSingle();
  if (error) return NextResponse.json({ error: `Хранилище рутин недоступно: ${error.message}` }, { status: 503 });
  return NextResponse.json({ state: data?.state ?? null, version: Number(data?.version ?? 0), updatedAt: data?.updated_at ?? null });
}

export async function POST(request: Request) {
  if (process.env.CRM_FORCE_LOCAL === "true") return NextResponse.json({ error: "Общее хранилище рутин доступно после подключения Supabase" }, { status: 503 });
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 1_500_000) return NextResponse.json({ error: "Состояние рутин слишком большое" }, { status: 413 });

  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Некорректное состояние рутин" }, { status: 400 });

  const { data, error } = await createServiceSupabaseClient().rpc("save_routines_state", {
    p_state: parsed.data.state,
    p_expected_version: parsed.data.expectedVersion,
    p_actor_id: user.id
  });
  if (error?.code === "40001") return NextResponse.json({ error: "Рутины изменены другим сотрудником. Обновите страницу." }, { status: 409 });
  if (error) return NextResponse.json({ error: `Не удалось сохранить рутины: ${error.message}` }, { status: 503 });
  return NextResponse.json({ version: Number(data) });
}
