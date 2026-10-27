import "server-only";

import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";
import type { CrmState, CrmUser, OsAppId } from "@/lib/crm/types";
import { canAccessApp } from "@/lib/os/apps";

export async function requireAppAccess(app: OsAppId): Promise<{ user: CrmUser; state: CrmState }> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user || !canAccessApp(user, app)) redirect("/");
  return { user, state };
}
