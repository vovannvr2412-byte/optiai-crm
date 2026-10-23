import type { User } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { CrmUser } from "@/lib/crm/types";

function userMetadata(user: CrmUser) {
  return {
    app_metadata: { crm_role: user.role, crm_user_id: user.id },
    user_metadata: { full_name: user.fullName, position: user.position }
  };
}

async function findAuthUserByEmail(email: string) {
  const admin = createServiceSupabaseClient().auth.admin;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  return null;
}

async function linkCrmUser(user: CrmUser, authUser: User) {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("crm_users").update({ auth_user_id: authUser.id }).eq("id", user.id);
  if (error) throw error;
}

export async function provisionSupabaseAuthUser(user: CrmUser, password: string) {
  const supabase = createServiceSupabaseClient();
  const existing = await findAuthUserByEmail(user.email);
  let authUser: User;

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      ...userMetadata(user)
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      ...userMetadata(user)
    });
    if (error) throw error;
    authUser = data.user;
  }

  await linkCrmUser(user, authUser);
  return authUser;
}

export async function linkAuthenticatedUser(user: CrmUser, authUser: User) {
  const { data, error } = await createServiceSupabaseClient().auth.admin.updateUserById(authUser.id, userMetadata(user));
  if (error) throw error;
  await linkCrmUser(user, data.user);
}

async function authUserIdForCrmUser(userId: string) {
  const { data, error } = await createServiceSupabaseClient()
    .from("crm_users")
    .select("auth_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.auth_user_id ? String(data.auth_user_id) : null;
}

export async function banSupabaseAuthUser(userId: string) {
  const authUserId = await authUserIdForCrmUser(userId);
  if (!authUserId) return;
  const { error } = await createServiceSupabaseClient().auth.admin.updateUserById(authUserId, { ban_duration: "876000h" });
  if (error) throw error;
}

export async function deleteSupabaseAuthUser(authUserId: string | null) {
  if (!authUserId) return;
  const { error } = await createServiceSupabaseClient().auth.admin.deleteUser(authUserId);
  if (error) throw error;
}

export async function getAuthUserIdForCrmUser(userId: string) {
  return authUserIdForCrmUser(userId);
}
