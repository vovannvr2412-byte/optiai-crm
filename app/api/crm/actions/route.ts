import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { banSupabaseAuthUser, deleteSupabaseAuthUser, getAuthUserIdForCrmUser, provisionSupabaseAuthUser } from "@/lib/auth/supabase-users";
import { applyCrmActionAsync, dashboardMetrics, getCrmStateAsync, scopedStateForAsync } from "@/lib/crm/store";
import type { CrmAction, CrmUser } from "@/lib/crm/types";
import { supabaseAuthEnabled } from "@/lib/supabase/auth";

const actionSchema = z.object({
  type: z.string(),
  payload: z.unknown()
});

const updateLeadPayloadSchema = z.object({
  leadId: z.string().min(1),
  changes: z.record(z.string(), z.unknown())
});

const deleteLeadPayloadSchema = z.object({ leadId: z.string().min(1) });
const createUserPayloadSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email(),
  role: z.enum(["Руководитель", "РОП", "Менеджер", "Аккаунт-менеджер"]),
  position: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(128)
});
const createWarmupStepPayloadSchema = z.object({
  sequenceId: z.string().min(1),
  day: z.number().int().min(0).max(3650),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4000),
  attachmentUrl: z.string().url().optional(),
  attachmentType: z.enum(["image", "video"]).optional(),
  attachmentName: z.string().max(255).optional()
});
const deleteWarmupStepPayloadSchema = z.object({ sequenceId: z.string().min(1), stepId: z.string().min(1) });

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const fullState = await getCrmStateAsync();
  const currentUser = fullState.users.find((user) => user.id === userId && user.status === "active");
  if (!currentUser) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 401 });
  }

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректное API-действие" }, { status: 400 });
  }

  const action = parsed.data as CrmAction;
  if (action.type === "create_user" && !createUserPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Укажите корректные данные и пароль не короче 8 символов" }, { status: 400 });
  }
  if (action.type === "update_lead" && !updateLeadPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Проверьте поля формы редактирования лида" }, { status: 400 });
  }
  if (action.type === "delete_lead" && !deleteLeadPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Некорректный идентификатор лида" }, { status: 400 });
  }
  if (action.type === "create_warmup_step" && !createWarmupStepPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Проверьте день, название, текст и вложение шага прогрева" }, { status: 400 });
  }
  if (action.type === "delete_warmup_step" && !deleteWarmupStepPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Некорректный шаг прогрева" }, { status: 400 });
  }
  if (!canRunAction(currentUser, action, fullState)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  let state;
  try {
    const deletedAuthUserId = action.type === "delete_user" && supabaseAuthEnabled()
      ? await getAuthUserIdForCrmUser(action.payload.userId)
      : null;
    await applyCrmActionAsync(action);
    if (supabaseAuthEnabled()) {
      if (action.type === "create_user") {
        const savedState = await getCrmStateAsync();
        const createdUser = savedState.users.find((user) => user.email.toLowerCase() === action.payload.email.trim().toLowerCase());
        if (!createdUser) throw new Error("Созданный сотрудник не найден в CRM.");
        try {
          await provisionSupabaseAuthUser(createdUser, action.payload.password);
        } catch (error) {
          await applyCrmActionAsync({ type: "delete_user", payload: { userId: createdUser.id } });
          throw error;
        }
      }
      if (action.type === "disable_user") await banSupabaseAuthUser(action.payload.userId);
      if (action.type === "delete_user") await deleteSupabaseAuthUser(deletedAuthUserId);
    }
    state = await scopedStateForAsync(currentUser.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("CRM action failed", { actionType: action.type, message, error });
    return NextResponse.json({ error: `CRM не смогла сохранить действие: ${message}` }, { status: 500 });
  }
  return NextResponse.json({
    currentUser,
    state,
    metrics: dashboardMetrics(state)
  });
}

function canRunAction(user: CrmUser, action: CrmAction, state: Awaited<ReturnType<typeof getCrmStateAsync>>) {
  if (user.role === "Руководитель") return true;
  if (action.type === "create_user") {
    return user.role === "РОП" && (action.payload.role === "Менеджер" || action.payload.role === "Аккаунт-менеджер");
  }
  if (action.type === "disable_user" || action.type === "delete_user") return false;
  if (action.type === "create_warmup_step" || action.type === "delete_warmup_step") return user.role === "РОП";
  if (user.role === "РОП") return action.type !== "toggle_integration" && action.type !== "configure_integration";
  if (action.type === "assign_lead" || action.type === "toggle_integration" || action.type === "configure_integration" || action.type === "run_automation") {
    return false;
  }

  if (action.type === "create_lead") return action.payload.ownerId === user.id;

  const leadId = leadIdFromAction(action);
  if (leadId) {
    const lead = state.leads.find((item) => item.id === leadId);
    if (!lead || lead.ownerId !== user.id) return false;
    if (user.role === "Аккаунт-менеджер" && lead.status !== "client") return false;
    if (action.type === "update_lead" && action.payload.changes.ownerId && action.payload.changes.ownerId !== user.id) return false;
  }
  return true;
}

function leadIdFromAction(action: CrmAction) {
  if (
    action.type === "update_lead"
    || action.type === "delete_lead"
    || action.type === "move_stage"
    || action.type === "record_call"
    || action.type === "mark_no_answer"
    || action.type === "send_message"
    || action.type === "start_warmup"
    || action.type === "mark_paid"
    || action.type === "mark_refused"
  ) {
    return action.payload.leadId;
  }
  return null;
}
