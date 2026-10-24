import { NextResponse } from "next/server";
import { createServerAuthClient } from "@/lib/supabase/auth";

const allowedNext = new Set(["/", "/set-password"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") ?? "/";
  const next = allowedNext.has(requestedNext) ? requestedNext : "/";
  if (!code) return NextResponse.redirect(new URL("/?authError=missing_code", url.origin));

  const auth = await createServerAuthClient();
  const { error } = await auth.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/?authError=invalid_link", url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}
