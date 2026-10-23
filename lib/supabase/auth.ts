import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function authEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase Auth не настроен: отсутствуют URL или публичный ключ.");
  return { url, key };
}

export function supabaseAuthEnabled() {
  return process.env.CRM_FORCE_LOCAL !== "true"
    && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function createServerAuthClient() {
  const { url, key } = authEnvironment();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, {
            ...options,
            secure: process.env.AUTH_COOKIE_SECURE === "true"
          });
        });
      }
    }
  });
}
