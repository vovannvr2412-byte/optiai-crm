import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { applyCrmAction, dashboardMetrics, getCrmState, scopedStateFor } from "@/lib/crm/store";
import type { CrmAction, CrmUser } from "@/lib/crm/types";

const actionSchema = z.object({
  type: z.string(),
  payload: z.unknown()
});

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const currentUser = getCrmState().users.find((user) => user.id === userId && user.status === "active");
  if (!currentUser) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 401 });
  }

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректное API-действие" }, { status: 400 });
  }

  const action = parsed.data as CrmAction;
  if (!canRunAction(currentUser, action)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  applyCrmAction(action);
  const state = scopedStateFor(currentUser.id);
  return NextResponse.json({
    currentUser,
    state,
    metrics: dashboardMetrics(state)
  });
}

function canRunAction(user: CrmUser, action: CrmAction) {
  if (user.role === "Руководитель") return true;
  if (action.type === "create_user" || action.type === "disable_user" || action.type === "delete_user") return false;
  if (user.role === "РОП") return action.type !== "toggle_integration";
  if (action.type === "assign_lead" || action.type === "toggle_integration" || action.type === "run_automation") {
    return false;
  }
  return true;
}
