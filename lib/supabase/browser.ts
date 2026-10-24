import { createBrowserClient } from "@supabase/ssr";

export function createBrowserAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase Auth не настроен.");
  return createBrowserClient(url, key);
}
