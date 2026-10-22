import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { listConversationsForUser, listMessagesForUser } from "@/lib/messaging/store";

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");
    const conversations = await listConversationsForUser(userId, url.searchParams.get("query") ?? "");
    if (!conversationId) return NextResponse.json({ conversations });
    const before = url.searchParams.get("before") || undefined;
    const limit = Number(url.searchParams.get("limit") || 40);
    const history = await listMessagesForUser(userId, conversationId, before, Number.isFinite(limit) ? limit : 40);
    return NextResponse.json({ conversations, ...history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить переписку.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
