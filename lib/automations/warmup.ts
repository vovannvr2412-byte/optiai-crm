import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function assignWarmupSequence(leadId: string, sequenceId: string, assignedBy: string) {
  const supabase = createServiceSupabaseClient();
  const { error: pauseError } = await supabase
    .from("warmup_assignments")
    .update({ status: "paused" })
    .eq("lead_id", leadId)
    .eq("status", "active");
  if (pauseError) throw pauseError;

  const { data, error } = await supabase.from("warmup_assignments").insert({
    lead_id: leadId,
    sequence_id: sequenceId,
    assigned_by: assignedBy,
    status: "active",
    started_at: new Date().toISOString().slice(0, 10)
  }).select("id").single();
  if (error) throw error;
  return String(data.id);
}
