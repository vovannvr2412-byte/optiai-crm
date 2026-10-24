import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { listNotificationsForUser, markNotificationRead } from "@/lib/notifications/store";

const patchSchema = z.object({ notificationId: z.string().uuid().optional(), all: z.boolean().optional() })
  .refine((value) => Boolean(value.notificationId || value.all));

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  return NextResponse.json({ notifications: await listNotificationsForUser(userId) }, {
    headers: { "Cache-Control": "private, no-store" }
  });
}

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректное уведомление" }, { status: 400 });
  await markNotificationRead(userId, parsed.data.all ? undefined : parsed.data.notificationId);
  return NextResponse.json({ notifications: await listNotificationsForUser(userId) });
}
