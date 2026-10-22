import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { markConversationRead, updateConversationForUser } from "@/lib/messaging/store";

const schema = z.object({
  leadId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["open", "waiting", "closed"]).optional(),
  markRead: z.boolean().optional()
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные данные диалога." }, { status: 400 });
  const { id } = await context.params;
  try {
    if (parsed.data.markRead) await markConversationRead(userId, id);
    const changes = { ...parsed.data };
    delete changes.markRead;
    const conversation = Object.keys(changes).length ? await updateConversationForUser(userId, id, changes) : undefined;
    return NextResponse.json({ ok: true, conversation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить диалог." }, { status: 400 });
  }
}
