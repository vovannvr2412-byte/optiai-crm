import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { CrmAction, CrmUser } from "@/lib/crm/types";

export type SecurityAuditEntry = {
  id: number;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string;
  details: Record<string, unknown>;
  createdAt: string;
};

function enabled() {
  return process.env.CRM_FORCE_LOCAL !== "true" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function recordSecurityAudit(
  actor: CrmUser,
  action: string,
  entityType: string,
  entityId?: string,
  details: Record<string, unknown> = {}
) {
  if (!enabled()) return;
  const { error } = await createServiceSupabaseClient().from("security_audit_log").insert({
    actor_user_id: actor.id,
    actor_email: actor.email,
    actor_role: actor.role,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    details
  });
  if (error) throw error;
}

export async function recordSecurityAuditSafe(
  actor: CrmUser,
  action: string,
  entityType: string,
  entityId?: string,
  details: Record<string, unknown> = {}
) {
  try {
    await recordSecurityAudit(actor, action, entityType, entityId, details);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "42P01" || code === "PGRST205") return;
    console.error("Security audit write failed", { action, entityType, entityId, error });
  }
}

export async function listSecurityAudit(limit = 50): Promise<SecurityAuditEntry[]> {
  if (!enabled()) return [];
  const { data, error } = await createServiceSupabaseClient()
    .from("security_audit_log")
    .select("id,actor_email,actor_role,action,entity_type,entity_id,details,created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  return (data ?? []).map((item) => ({
    id: Number(item.id),
    actorEmail: String(item.actor_email),
    actorRole: String(item.actor_role),
    action: String(item.action),
    entityType: String(item.entity_type),
    entityId: item.entity_id ? String(item.entity_id) : undefined,
    details: (item.details ?? {}) as Record<string, unknown>,
    createdAt: String(item.created_at)
  }));
}

export function auditDescriptor(action: CrmAction) {
  switch (action.type) {
    case "create_user":
      return { action: "user.invited", entityType: "crm_user", details: { email: action.payload.email, role: action.payload.role } };
    case "disable_user":
      return { action: "user.disabled", entityType: "crm_user", entityId: action.payload.userId };
    case "delete_user":
      return { action: "user.deleted", entityType: "crm_user", entityId: action.payload.userId };
    case "complete_task":
      return { action: "task.completed", entityType: "task", entityId: action.payload.taskId };
    case "reschedule_task":
      return { action: "task.rescheduled", entityType: "task", entityId: action.payload.taskId, details: { dueAt: action.payload.dueAt } };
    case "cancel_task":
      return { action: "task.cancelled", entityType: "task", entityId: action.payload.taskId };
    case "record_call_result":
      return {
        action: "call.result_recorded",
        entityType: "lead",
        entityId: action.payload.leadId,
        details: { result: action.payload.result }
      };
    case "assign_lead":
      return { action: "lead.assigned", entityType: "lead", entityId: action.payload.leadId, details: { ownerId: action.payload.ownerId } };
    case "delete_lead":
      return { action: "lead.deleted", entityType: "lead", entityId: action.payload.leadId };
    case "configure_integration":
      return {
        action: "integration.configured",
        entityType: "integration",
        entityId: action.payload.integrationId,
        details: { fields: Object.keys(action.payload.config).sort() }
      };
    case "toggle_integration":
      return { action: "integration.status_changed", entityType: "integration", entityId: action.payload.integrationId };
    default:
      return null;
  }
}
