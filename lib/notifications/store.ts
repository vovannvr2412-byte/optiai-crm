import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { supabasePersistenceEnabled } from "@/lib/crm/store";
import { sendPushToUser } from "@/lib/push/store";

export type CrmNotification = {
  id: string;
  userId: string;
  leadId?: string;
  taskId?: string;
  type: "task_due" | "callback" | "warmup" | "renewal" | "automation" | "system" | "message";
  title: string;
  body: string;
  eventKey: string;
  readAt?: string;
  createdAt: string;
};

function toNotification(row: Record<string, unknown>): CrmNotification {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    leadId: row.lead_id ? String(row.lead_id) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined,
    type: row.type as CrmNotification["type"],
    title: String(row.title),
    body: String(row.body ?? ""),
    eventKey: String(row.event_key),
    readAt: row.read_at ? String(row.read_at) : undefined,
    createdAt: String(row.created_at)
  };
}

export async function listNotificationsForUser(userId: string, limit = 50) {
  if (!supabasePersistenceEnabled()) return [];
  const { data, error } = await createServiceSupabaseClient()
    .from("crm_notifications")
    .select("id,user_id,lead_id,task_id,type,title,body,event_key,read_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  return (data ?? []).map((row) => toNotification(row as Record<string, unknown>));
}

export async function createNotification(input: {
  userId: string;
  leadId?: string;
  taskId?: string;
  type: CrmNotification["type"];
  title: string;
  body: string;
  eventKey: string;
  url?: string;
}) {
  if (!supabasePersistenceEnabled()) return;
  const { data, error } = await createServiceSupabaseClient().from("crm_notifications").upsert({
    user_id: input.userId,
    lead_id: input.leadId ?? null,
    task_id: input.taskId ?? null,
    type: input.type,
    title: input.title,
    body: input.body,
    event_key: input.eventKey
  }, { onConflict: "event_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw error;
  if (data) {
    await sendPushToUser(input.userId, {
      title: input.title,
      body: input.body,
      url: input.url ?? (input.leadId ? `/?lead=${encodeURIComponent(input.leadId)}` : "/?view=tasks"),
      tag: input.eventKey
    }).catch((pushError) => console.error("Push notification failed", { message: pushError instanceof Error ? pushError.message : String(pushError) }));
  }
}

export async function markNotificationRead(userId: string, notificationId?: string) {
  if (!supabasePersistenceEnabled()) return;
  let query = createServiceSupabaseClient()
    .from("crm_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (notificationId) query = query.eq("id", notificationId);
  const { error } = await query;
  if (error) throw error;
}

export async function markTaskNotificationsRead(userId: string, taskId: string) {
  if (!supabasePersistenceEnabled()) return;
  const { error } = await createServiceSupabaseClient()
    .from("crm_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .is("read_at", null);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
}
