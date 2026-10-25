import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { deletePushSubscription, savePushSubscription } from "@/lib/push/store";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4000),
  keys: z.object({ p256dh: z.string().min(20).max(500), auth: z.string().min(8).max(500) })
});

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректная push-подписка." }, { status: 400 });
  try {
    await savePushSubscription(userId, parsed.data, request.headers.get("user-agent") ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить push-подписку." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "Не указан endpoint." }, { status: 400 });
  await deletePushSubscription(userId, endpoint);
  return NextResponse.json({ ok: true });
}
