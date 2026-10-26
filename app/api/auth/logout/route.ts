import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";

export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0"
    }
  });
}
