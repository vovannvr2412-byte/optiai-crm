import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmState } from "@/lib/crm/store";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ user: null }, { status: 401 });

  const user = getCrmState().users.find((item) => item.id === userId && item.status === "active");
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  return NextResponse.json({ user });
}
