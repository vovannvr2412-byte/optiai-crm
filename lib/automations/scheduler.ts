import { applyCrmActionAsync, getCrmStateAsync, supabasePersistenceEnabled } from "@/lib/crm/store";
import type { Lead, WarmupStep } from "@/lib/crm/types";
import { createPendingMessageOnce, finishOutgoingMessage, listConversationMessagesSystem, listConversationsForUser } from "@/lib/messaging/store";
import { providerFor } from "@/lib/messaging/providers";
import { safeProviderError } from "@/lib/messaging/config";
import type { MessengerConversation, OutgoingMediaAttachment } from "@/lib/messaging/types";
import { createNotification } from "@/lib/notifications/store";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { syncScheduledExternalIntegrations } from "@/lib/external-integrations";
import { personalizeWarmupMessage } from "@/lib/ai/service";
import { assignWarmupSequence } from "./warmup";

type SchedulerStats = {
  claimed: number;
  completed: number;
  failed: number;
  notifications: number;
  messages: number;
  tasks: number;
  warmups: number;
};

export type AutomationStatus = {
  status: "not_started" | "running" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  stats: Partial<SchedulerStats>;
  error?: string;
};

type ClaimedEvent = { id: string; attempts: number };

function dateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function daysBetween(from: string, to: string) {
  return Math.floor((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

function scheduledTime(day: string) {
  return `${day.slice(0, 10)}T06:00:00.000Z`;
}

function cleanError(error: unknown) {
  return safeProviderError(error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

async function claimEvent(input: {
  eventKey: string;
  kind: string;
  scheduledFor: string;
  leadId?: string;
  userId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
}): Promise<ClaimedEvent | null> {
  const { data, error } = await createServiceSupabaseClient().rpc("claim_automation_event", {
    p_event_key: input.eventKey,
    p_kind: input.kind,
    p_scheduled_for: input.scheduledFor,
    p_lead_id: input.leadId ?? null,
    p_user_id: input.userId ?? null,
    p_task_id: input.taskId ?? null,
    p_payload: input.payload ?? {}
  });
  if (error) throw error;
  const item = Array.isArray(data) ? data[0] : data;
  return item ? { id: String(item.id), attempts: Number(item.attempts) } : null;
}

async function finishEvent(id: string, status: "completed" | "failed" | "skipped", error?: string) {
  const failed = status === "failed";
  const { error: updateError } = await createServiceSupabaseClient().from("automation_events").update({
    status,
    error: error ?? null,
    locked_at: null,
    processed_at: failed ? null : new Date().toISOString(),
    next_attempt_at: failed ? new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq("id", id);
  if (updateError) throw updateError;
}

async function processEvent(
  input: Parameters<typeof claimEvent>[0],
  stats: SchedulerStats,
  operation: () => Promise<void>
) {
  const claimed = await claimEvent(input);
  if (!claimed) return false;
  stats.claimed += 1;
  try {
    await operation();
    await finishEvent(claimed.id, "completed");
    stats.completed += 1;
    return true;
  } catch (error) {
    await finishEvent(claimed.id, "failed", cleanError(error));
    stats.failed += 1;
    return false;
  }
}

async function sendAutomatedMessage(input: {
  lead: Lead;
  text: string;
  idempotencyKey: string;
  attachment?: OutgoingMediaAttachment;
  conversation?: MessengerConversation;
}) {
  const conversation = input.conversation ?? (await listConversationsForUser(input.lead.ownerId)).find((item) => item.leadId === input.lead.id);
  if (!conversation) throw new Error("У лида нет привязанного чата в центре сообщений.");
  if (conversation.channel === "telegram" && conversation.needsReconnect) {
    throw new Error("Telegram-диалог ожидает /start у нового бота.");
  }

  const adapter = providerFor(conversation.channel);
  if (!await adapter.isConfigured()) throw new Error(`${conversation.channel}: подключение не настроено.`);
  const pending = await createPendingMessageOnce(
    input.lead.ownerId,
    conversation.id,
    input.text,
    input.idempotencyKey,
    input.attachment
  );
  if (["sent", "delivered", "read"].includes(pending.message.status)) return;

  try {
    const result = input.attachment
      ? adapter.sendAutomationMedia
        ? await adapter.sendAutomationMedia(conversation, input.attachment, input.text || undefined)
        : await adapter.sendMedia(conversation, input.attachment, input.text || undefined)
      : adapter.sendAutomationText
        ? await adapter.sendAutomationText(conversation, input.text)
        : await adapter.sendText(conversation, input.text);
    await finishOutgoingMessage(pending.message.id, result);
  } catch (error) {
    await finishOutgoingMessage(pending.message.id, { status: "failed", errorReason: cleanError(error) });
    throw error;
  }

  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();
  const { error: leadError } = await supabase.from("leads").update({ last_contact_at: now }).eq("id", input.lead.id);
  if (leadError) throw leadError;
  const { error: activityError } = await supabase.from("activities").insert({
    lead_id: input.lead.id,
    type: "message",
    title: `Автоматическое сообщение · ${conversation.channel}`,
    detail: input.text || input.attachment?.name || "Вложение прогрева",
    created_at: now
  });
  if (activityError) throw activityError;
}

async function runNoResponseAutomations(stats: SchedulerStats) {
  const state = await getCrmStateAsync();
  const today = dateOnly();
  for (const lead of state.leads) {
    if (lead.status === "client" || lead.status === "lost") continue;
    const anchor = (lead.lastContactAt ?? lead.createdAt).slice(0, 10);
    const elapsed = daysBetween(anchor, today);
    const threshold = elapsed >= 14 ? 14 : elapsed >= 7 ? 7 : elapsed >= 3 ? 3 : 0;
    if (!threshold) continue;
    const eventKey = `no-response:${threshold}:${lead.id}:${anchor}`;
    await processEvent({
      eventKey,
      kind: `no_response_${threshold}`,
      scheduledFor: scheduledTime(addDays(anchor, threshold)),
      leadId: lead.id,
      userId: lead.ownerId,
      payload: { threshold, anchor }
    }, stats, async () => {
      if (threshold === 3) {
        await sendAutomatedMessage({
          lead,
          text: "Добрый день! Подскажите, удалось посмотреть материалы OptiAI? Могу ответить на вопросы и предложить следующий шаг.",
          idempotencyKey: eventKey
        });
        stats.messages += 1;
        return;
      }

      if (threshold === 7) {
        const supabase = createServiceSupabaseClient();
        const { data: existing, error: findError } = await supabase.from("tasks").select("id").eq("automation_key", eventKey).maybeSingle();
        if (findError) throw findError;
        if (!existing) {
          const { error } = await supabase.from("tasks").insert({
            lead_id: lead.id,
            owner_id: lead.ownerId,
            title: "Нет ответа 7 дней: связаться с лидом вручную",
            due_at: today,
            priority: "high",
            status: "open",
            automation_key: eventKey
          });
          if (error) throw error;
          const { error: activityError } = await supabase.from("activities").insert({
            lead_id: lead.id,
            type: "task",
            title: "Автоматизация 7 дней",
            detail: "CRM поставила ответственному задачу связаться с лидом вручную."
          });
          if (activityError) throw activityError;
          stats.tasks += 1;
        }
        return;
      }

      const sequence = state.warmupSequences.find((item) => item.active);
      if (!sequence) throw new Error("Нет активной цепочки прогрева для реактивации.");
      await applyCrmActionAsync({ type: "start_warmup", payload: { leadId: lead.id, sequenceId: sequence.id } });
      await assignWarmupSequence(lead.id, sequence.id, lead.ownerId);
      stats.warmups += 1;
    });
  }
}

async function runWarmupSteps(stats: SchedulerStats) {
  const supabase = createServiceSupabaseClient();
  const [{ data: assignments, error: assignmentsError }, state] = await Promise.all([
    supabase.from("warmup_assignments").select("id,lead_id,sequence_id,started_at").eq("status", "active").order("started_at"),
    getCrmStateAsync()
  ]);
  if (assignmentsError) throw assignmentsError;
  const today = dateOnly();

  for (const assignment of assignments ?? []) {
    const lead = state.leads.find((item) => item.id === String(assignment.lead_id));
    const sequence = state.warmupSequences.find((item) => item.id === String(assignment.sequence_id));
    if (!lead || !sequence || sequence.steps.length === 0) {
      await supabase.from("warmup_assignments").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", assignment.id);
      continue;
    }
    const keys = sequence.steps.map((step) => `warmup:${assignment.id}:${step.id}`);
    const { data: completedRows, error: completedError } = await supabase
      .from("automation_events")
      .select("event_key")
      .in("event_key", keys)
      .eq("status", "completed");
    if (completedError) throw completedError;
    const completed = new Set((completedRows ?? []).map((item) => String(item.event_key)));
    const dueStep = [...sequence.steps]
      .sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, "ru"))
      .find((step) => addDays(String(assignment.started_at), step.day) <= today && !completed.has(`warmup:${assignment.id}:${step.id}`));

    if (!dueStep) {
      if (keys.every((key) => completed.has(key))) {
        await supabase.from("warmup_assignments").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", assignment.id);
      }
      continue;
    }

    const eventKey = `warmup:${assignment.id}:${dueStep.id}`;
    const success = await processEvent({
      eventKey,
      kind: "warmup_step",
      scheduledFor: scheduledTime(addDays(String(assignment.started_at), dueStep.day)),
      leadId: lead.id,
      userId: lead.ownerId,
      payload: { assignmentId: assignment.id, sequenceId: sequence.id, stepId: dueStep.id, day: dueStep.day }
    }, stats, async () => {
      const attachment = warmupAttachment(dueStep);
      const conversation = (await listConversationsForUser(lead.ownerId)).find((item) => item.leadId === lead.id);
      if (!conversation) throw new Error("У лида нет привязанного чата в центре сообщений.");
      let message = dueStep.message;
      try {
        message = await personalizeWarmupMessage({
          conversation,
          messages: await listConversationMessagesSystem(conversation.id, 20),
          lead,
          sequenceName: sequence.name,
          stepTitle: dueStep.title,
          template: dueStep.message
        });
      } catch (error) {
        console.error("AI warmup personalization failed; using authored template", { leadId: lead.id, stepId: dueStep.id, error: cleanError(error) });
      }
      await sendAutomatedMessage({ lead, text: message, idempotencyKey: eventKey, attachment, conversation });
      const { error: taskError } = await supabase.from("tasks").update({ status: "done" })
        .eq("lead_id", lead.id)
        .eq("automation_key", `warmup:${sequence.id}:${dueStep.id}`)
        .eq("status", "open");
      if (taskError) throw taskError;
      await createNotification({
        userId: lead.ownerId,
        leadId: lead.id,
        type: "warmup",
        title: `Прогрев отправлен: ${dueStep.title}`,
        body: `${lead.companyName} · день ${dueStep.day}`,
        eventKey: `notification:${eventKey}`
      });
      stats.messages += 1;
      stats.notifications += 1;
    });

    if (!success) {
      await createNotification({
        userId: lead.ownerId,
        leadId: lead.id,
        type: "automation",
        title: `Не отправлен прогрев: ${dueStep.title}`,
        body: "Проверьте привязку чата и подключение бота. CRM повторит попытку завтра.",
        eventKey: `notification:blocked:${eventKey}`
      });
      stats.notifications += 1;
    } else {
      completed.add(eventKey);
      if (keys.every((key) => completed.has(key))) {
        await supabase.from("warmup_assignments").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", assignment.id);
      }
    }
  }
}

function warmupAttachment(step: WarmupStep): OutgoingMediaAttachment | undefined {
  if (!step.attachmentUrl || !step.attachmentType) return undefined;
  return { type: step.attachmentType, url: step.attachmentUrl, name: step.attachmentName };
}

async function runDueTaskNotifications(stats: SchedulerStats) {
  const state = await getCrmStateAsync();
  const today = dateOnly();
  for (const task of state.tasks.filter((item) => item.status === "open" && item.dueAt <= today)) {
    const lead = state.leads.find((item) => item.id === task.leadId);
    const eventKey = `task-due:${task.id}:${task.dueAt}`;
    await processEvent({
      eventKey,
      kind: "task_due",
      scheduledFor: scheduledTime(task.dueAt),
      leadId: task.leadId,
      userId: task.ownerId,
      taskId: task.id
    }, stats, async () => {
      const callback = task.automationKey === "missed_call" || task.automationKey?.startsWith("missed_call:");
      await createNotification({
        userId: task.ownerId,
        leadId: task.leadId,
        taskId: task.id,
        type: callback ? "callback" : "task_due",
        title: callback ? "Пора перезвонить клиенту" : "Наступил срок задачи",
        body: `${lead?.companyName ?? "Лид"} · ${task.title}`,
        eventKey
      });
      stats.notifications += 1;
    });
  }
}

async function runRenewalReminders(stats: SchedulerStats) {
  const state = await getCrmStateAsync();
  const today = dateOnly();
  for (const subscription of state.subscriptions.filter((item) => item.status === "active")) {
    const remaining = daysBetween(today, subscription.endsAt);
    if (remaining < 0 || remaining > 30) continue;
    const threshold = [30, 14, 7, 3].find((days) => remaining === days);
    if (!threshold) continue;
    const lead = state.leads.find((item) => item.id === subscription.leadId);
    if (!lead) continue;
    const eventKey = `renewal:${subscription.id}:${subscription.endsAt}:${threshold}`;
    await processEvent({
      eventKey,
      kind: "renewal_reminder",
      scheduledFor: scheduledTime(addDays(subscription.endsAt, -threshold)),
      leadId: lead.id,
      userId: lead.ownerId,
      payload: { subscriptionId: subscription.id, days: threshold, endsAt: subscription.endsAt }
    }, stats, async () => {
      await createNotification({
        userId: lead.ownerId,
        leadId: lead.id,
        type: "renewal",
        title: `Продление через ${threshold} дн.`,
        body: `${lead.companyName} · договор до ${subscription.endsAt}`,
        eventKey
      });
      stats.notifications += 1;
    });
  }
}

export async function runAutomationScheduler(source = "vercel_cron") {
  const supabase = createServiceSupabaseClient();
  const stats: SchedulerStats = { claimed: 0, completed: 0, failed: 0, notifications: 0, messages: 0, tasks: 0, warmups: 0 };
  const { data: run, error: runError } = await supabase.from("automation_runs").insert({ source, status: "running" }).select("id,started_at").single();
  if (runError) throw runError;
  try {
    await runNoResponseAutomations(stats);
    await runWarmupSteps(stats);
    await runDueTaskNotifications(stats);
    await runRenewalReminders(stats);
    const integrations = await syncScheduledExternalIntegrations();
    const finishedAt = new Date().toISOString();
    const { error } = await supabase.from("automation_runs").update({ status: "completed", stats: { ...stats, integrations }, finished_at: finishedAt }).eq("id", run.id);
    if (error) throw error;
    return { runId: String(run.id), startedAt: String(run.started_at), finishedAt, stats, integrations };
  } catch (error) {
    await supabase.from("automation_runs").update({
      status: "failed",
      stats,
      error: cleanError(error),
      finished_at: new Date().toISOString()
    }).eq("id", run.id);
    throw error;
  }
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  if (!supabasePersistenceEnabled()) return { status: "not_started", stats: {} };
  const { data, error } = await createServiceSupabaseClient()
    .from("automation_runs")
    .select("status,stats,error,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return { status: "not_started", stats: {} };
    throw error;
  }
  if (!data) return { status: "not_started", stats: {} };
  return {
    status: data.status as AutomationStatus["status"],
    startedAt: String(data.started_at),
    finishedAt: data.finished_at ? String(data.finished_at) : undefined,
    stats: (data.stats ?? {}) as Partial<SchedulerStats>,
    error: data.error ? String(data.error) : undefined
  };
}
