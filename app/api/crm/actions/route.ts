import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { banSupabaseAuthUser, deleteSupabaseAuthUser, getAuthUserIdForCrmUser, inviteSupabaseAuthUser } from "@/lib/auth/supabase-users";
import { passwordSetupUrl } from "@/lib/auth/urls";
import { applyCrmActionAsync, dashboardMetrics, getCrmStateAsync, scopedStateForAsync } from "@/lib/crm/store";
import type { CrmAction, CrmUser } from "@/lib/crm/types";
import { saveIntegrationSecrets } from "@/lib/integrations/secrets";
import { auditDescriptor, listSecurityAudit, recordSecurityAuditSafe } from "@/lib/security/audit";
import { supabaseAuthEnabled } from "@/lib/supabase/auth";
import { listNotificationsForUser, markTaskNotificationsRead } from "@/lib/notifications/store";
import { assignWarmupSequence } from "@/lib/automations/warmup";
import { getAutomationStatus } from "@/lib/automations/scheduler";

const actionSchema = z.object({
  type: z.string(),
  payload: z.unknown()
});

const updateLeadPayloadSchema = z.object({
  leadId: z.string().min(1),
  changes: z.record(z.string(), z.unknown())
});

const deleteLeadPayloadSchema = z.object({ leadId: z.string().min(1) });
const taskPayloadSchema = z.object({ taskId: z.string().min(1) });
const rescheduleTaskPayloadSchema = taskPayloadSchema.extend({ dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const callResultPayloadSchema = z.object({
  leadId: z.string().min(1),
  ownerId: z.string().min(1),
  result: z.enum(["answered", "no_answer", "meeting", "comment"]),
  comment: z.string().trim().max(2000).optional()
}).refine((value) => value.result !== "comment" || Boolean(value.comment), {
  message: "Для комментария нужен текст",
  path: ["comment"]
});
const createUserPayloadSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email(),
  role: z.enum(["Руководитель", "РОП", "Менеджер", "Аккаунт-менеджер"]),
  position: z.string().trim().min(2).max(120)
});
const configureIntegrationPayloadSchema = z.object({
  integrationId: z.string().min(1).max(80),
  config: z.record(z.string().min(1).max(100), z.string().max(12000)).refine((value) => Object.keys(value).length <= 30)
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
    return NextResponse.json({ error: "Укажите корректные данные сотрудника" }, { status: 400 });
  }
  if (action.type === "configure_integration" && !configureIntegrationPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Проверьте поля интеграции" }, { status: 400 });
  }
  if (action.type === "update_lead" && !updateLeadPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Проверьте поля формы редактирования лида" }, { status: 400 });
  }
  if (action.type === "delete_lead" && !deleteLeadPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Некорректный идентификатор лида" }, { status: 400 });
  }
  if ((action.type === "complete_task" || action.type === "cancel_task") && !taskPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
  }
  if (action.type === "reschedule_task" && !rescheduleTaskPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Укажите корректную дату переноса" }, { status: 400 });
  }
  if (action.type === "record_call_result" && !callResultPayloadSchema.safeParse(action.payload).success) {
    return NextResponse.json({ error: "Выберите результат звонка и проверьте комментарий" }, { status: 400 });
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
  if (action.type === "create_user" && !supabaseAuthEnabled()) {
    return NextResponse.json({ error: "Для приглашения сотрудников подключите Supabase Auth." }, { status: 503 });
  }
  if ((action.type === "configure_integration" || action.type === "toggle_integration")
    && !fullState.integrations.some((item) => item.id === action.payload.integrationId)) {
    return NextResponse.json({ error: "Интеграция не найдена" }, { status: 404 });
  }

  let state;
  let createdUser: CrmUser | undefined;
  try {
    const deletedAuthUserId = action.type === "delete_user" && supabaseAuthEnabled()
      ? await getAuthUserIdForCrmUser(action.payload.userId)
      : null;
    if (action.type === "configure_integration") {
      await saveIntegrationSecrets(action.payload.integrationId, action.payload.config);
    }
    await applyCrmActionAsync(action);
    if (action.type === "start_warmup") {
      await assignWarmupSequence(action.payload.leadId, action.payload.sequenceId, currentUser.id);
    }
    if (action.type === "complete_task" || action.type === "cancel_task" || action.type === "reschedule_task") {
      await markTaskNotificationsRead(currentUser.id, action.payload.taskId);
    }
    if (supabaseAuthEnabled()) {
      if (action.type === "create_user") {
        const savedState = await getCrmStateAsync();
        createdUser = savedState.users.find((user) => user.email.toLowerCase() === action.payload.email.trim().toLowerCase());
        if (!createdUser) throw new Error("Созданный сотрудник не найден в CRM.");
        try {
          await inviteSupabaseAuthUser(createdUser, passwordSetupUrl(request));
        } catch (error) {
          await applyCrmActionAsync({ type: "delete_user", payload: { userId: createdUser.id } });
          throw error;
        }
      }
      if (action.type === "disable_user") await banSupabaseAuthUser(action.payload.userId);
      if (action.type === "delete_user") await deleteSupabaseAuthUser(deletedAuthUserId);
    }
    state = await scopedStateForAsync(currentUser.id);
    const audit = auditDescriptor(action);
    if (audit) {
      await recordSecurityAuditSafe(
        currentUser,
        audit.action,
        audit.entityType,
        createdUser?.id ?? audit.entityId,
        audit.details
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("CRM action failed", { actionType: action.type, message, error });
    if (action.type === "create_user" && /email rate limit/i.test(message)) {
      return NextResponse.json({ error: "Supabase временно ограничил отправку писем. Подключите собственный SMTP или повторите приглашение позже." }, { status: 429 });
    }
    return NextResponse.json({ error: `CRM не смогла сохранить действие: ${message}` }, { status: 500 });
  }
  return NextResponse.json({
    currentUser,
    state,
    metrics: dashboardMetrics(state),
    notifications: await listNotificationsForUser(currentUser.id),
    automationStatus: await getAutomationStatus(),
    auditLog: currentUser.role === "Руководитель" || currentUser.role === "РОП" ? await listSecurityAudit(30) : []
  });
}

function canRunAction(user: CrmUser, action: CrmAction, state: Awaited<ReturnType<typeof getCrmStateAsync>>) {
  if (action.type === "disable_user" || action.type === "delete_user") {
    const target = state.users.find((item) => item.id === action.payload.userId);
    return user.role === "Руководитель" && Boolean(target) && target?.role !== "Руководитель";
  }
  if (user.role === "Руководитель") return true;
  if (action.type === "create_user") {
    return user.role === "РОП" && (action.payload.role === "Менеджер" || action.payload.role === "Аккаунт-менеджер");
  }
  if (action.type === "create_warmup_step" || action.type === "delete_warmup_step") return user.role === "РОП";
  if (user.role === "РОП") return action.type !== "toggle_integration" && action.type !== "configure_integration";
  if (action.type === "assign_lead" || action.type === "toggle_integration" || action.type === "configure_integration" || action.type === "run_automation") {
    return false;
  }

  if (action.type === "create_lead") return user.role === "Менеджер" && action.payload.ownerId === user.id;
  if (action.type === "delete_lead") return false;

  if (action.type === "complete_task" || action.type === "cancel_task" || action.type === "reschedule_task") {
    const task = state.tasks.find((item) => item.id === action.payload.taskId);
    return Boolean(task && task.ownerId === user.id);
  }

  if ((action.type === "record_call" || action.type === "mark_no_answer" || action.type === "record_call_result") && action.payload.ownerId !== user.id) return false;

  const leadId = leadIdFromAction(action, state);
  if (leadId) {
    const lead = state.leads.find((item) => item.id === leadId);
    if (!lead || lead.ownerId !== user.id) return false;
    if (user.role === "Аккаунт-менеджер" && lead.status !== "client") return false;
    if (action.type === "update_lead" && action.payload.changes.ownerId && action.payload.changes.ownerId !== user.id) return false;
  }
  return true;
}

function leadIdFromAction(action: CrmAction, state: Awaited<ReturnType<typeof getCrmStateAsync>>) {
  if (
    action.type === "update_lead"
    || action.type === "delete_lead"
    || action.type === "move_stage"
    || action.type === "record_call"
    || action.type === "mark_no_answer"
    || action.type === "record_call_result"
    || action.type === "send_message"
    || action.type === "start_warmup"
    || action.type === "mark_paid"
    || action.type === "mark_refused"
  ) {
    return action.payload.leadId;
  }
  if (action.type === "renew_subscription") {
    return state.subscriptions.find((item) => item.id === action.payload.subscriptionId)?.leadId ?? null;
  }
  return null;
}
