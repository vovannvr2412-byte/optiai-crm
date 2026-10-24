import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createServerAuthClient, supabaseAuthEnabled } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const SESSION_COOKIE = "optiai_crm_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function secret() {
  return process.env.AUTH_SECRET || "optiai-local-demo-secret-change-me";
}

function base64url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function createToken(userId: string) {
  const payload = base64url(JSON.stringify({ userId, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 }));
  return `${payload}.${sign(payload)}`;
}

function parseToken(token?: string) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: string; exp?: number };
    if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.userId;
  } catch {
    return null;
  }
}

export async function setSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export async function clearSession() {
  try {
    if (supabaseAuthEnabled()) {
      const supabase = await createServerAuthClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) console.error("Supabase sign out failed", { message: error.message });
    }
  } catch (error) {
    console.error("Supabase sign out failed", {
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
  }
}

export async function getSessionUserId() {
  if (supabaseAuthEnabled()) {
    const auth = await createServerAuthClient();
    const { data, error } = await auth.auth.getUser();
    if (error || !data.user) return null;
    const { data: crmUser, error: crmError } = await createServiceSupabaseClient()
      .from("crm_users")
      .select("id,status")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (crmError || !crmUser || crmUser.status !== "active") return null;
    return String(crmUser.id);
  }
  const cookieStore = await cookies();
  return parseToken(cookieStore.get(SESSION_COOKIE)?.value);
}
