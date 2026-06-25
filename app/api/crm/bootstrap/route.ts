import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { dashboardMetrics, scopedStateForAsync } from "@/lib/crm/store";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const state = await scopedStateForAsync(userId);
  const currentUser = state.users.find((user) => user.id === userId);
  if (!currentUser) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 401 });
  }

  return NextResponse.json({
    currentUser,
    state,
    metrics: dashboardMetrics(state)
  });
}
