import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { listConnections } from "@/lib/messaging/store";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    return NextResponse.json({ connections: await listConnections() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось получить подключения." }, { status: 500 });
  }
}
