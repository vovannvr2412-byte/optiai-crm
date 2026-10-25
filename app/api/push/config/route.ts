import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";
import { ensureVapidConfiguration, getPushConfiguration, hasPushSubscription } from "@/lib/push/store";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const config = await getPushConfiguration();
    return NextResponse.json({ ...config, subscribed: await hasPushSubscription(userId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось проверить Web Push." }, { status: 500 });
  }
}

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user || user.role !== "Руководитель") return NextResponse.json({ error: "Первичную настройку Web Push выполняет руководитель." }, { status: 403 });
  try {
    const config = await ensureVapidConfiguration(user.email);
    return NextResponse.json({ configured: true, publicKey: config.publicKey, subscribed: await hasPushSubscription(userId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось настроить Web Push." }, { status: 500 });
  }
}
