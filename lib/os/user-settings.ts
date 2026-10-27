import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { CrmState, CrmUser, OsAppId } from "@/lib/crm/types";

type SettingsRow = { user_id: string; app_permissions: string[]; auto_assign_enabled: boolean };

function enabled() {
  if (process.env.CRM_FORCE_LOCAL === "true") return false;
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function hydrateUserSettings(state: CrmState) {
  if (!enabled()) return state;
  const { data, error } = await createServiceSupabaseClient().from("os_user_settings").select("user_id, app_permissions, auto_assign_enabled");
  if (error) {
    if (error.code === "42P01") return state;
    throw error;
  }
  const byUser = new Map((data as SettingsRow[] | null ?? []).map((row) => [row.user_id, row]));
  state.users.forEach((user) => {
    const settings = byUser.get(user.id);
    if (!settings) return;
    user.appPermissions = settings.app_permissions as OsAppId[];
    user.autoAssignEnabled = settings.auto_assign_enabled;
  });
  return state;
}

export async function saveUserSettings(user: Pick<CrmUser, "id" | "appPermissions" | "autoAssignEnabled">) {
  if (!enabled()) return;
  const { error } = await createServiceSupabaseClient().from("os_user_settings").upsert({
    user_id: user.id,
    app_permissions: user.appPermissions ?? [],
    auto_assign_enabled: Boolean(user.autoAssignEnabled),
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (error) throw error;
}
