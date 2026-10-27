import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { dashboardMetrics, getCrmStateAsync, salesPeriodMetrics, scopedStateForAsync } from "@/lib/crm/store";
import { listSecurityAudit } from "@/lib/security/audit";
import { listNotificationsForUser } from "@/lib/notifications/store";
import { getAutomationStatus } from "@/lib/automations/scheduler";
import { canAccessApp } from "@/lib/os/apps";
import type { OsAppId } from "@/lib/crm/types";

const appIds = new Set<OsAppId>(["leads", "management", "content", "routines", "settings", "team"]);

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const fullState = await getCrmStateAsync();
  const currentUser = fullState.users.find((user) => user.id === userId && user.status === "active");
  if (!currentUser) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 401 });
  }
  const requestedApp = new URL(request.url).searchParams.get("app") as OsAppId | null;
  if (requestedApp && (!appIds.has(requestedApp) || !canAccessApp(currentUser, requestedApp))) {
    return NextResponse.json({ error: "Недостаточно прав для приложения" }, { status: 403 });
  }
  const state = await scopedStateForAsync(userId);
  const metrics = dashboardMetrics(fullState);
  if (currentUser.role === "Менеджер" || currentUser.role === "РОП" || currentUser.role === "Технический специалист") {
    metrics.paidRevenue = 0;
    metrics.mrr = 0;
    metrics.churn = 0;
    metrics.ltv = 0;
    metrics.averageLifetimeMonths = 0;
    metrics.channels = metrics.channels.map((channel) => ({ ...channel, revenue: 0 }));
    metrics.managers = [];
  }

  return NextResponse.json({
    currentUser,
    state,
    metrics,
    salesMetrics: salesPeriodMetrics(fullState, currentUser),
    notifications: await listNotificationsForUser(currentUser.id),
    automationStatus: await getAutomationStatus(),
    auditLog: currentUser.role === "Руководитель" || currentUser.role === "РОП" ? await listSecurityAudit(30) : []
  });
}
