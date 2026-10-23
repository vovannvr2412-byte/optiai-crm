import { NextResponse } from "next/server";
import { telegramAdapter } from "@/lib/messaging/providers/telegram";
import { saveIncomingMessage } from "@/lib/messaging/store";
import { getMessengerSecrets } from "@/lib/messaging/secrets";

export async function POST(request: Request) {
  const secret = (await getMessengerSecrets("telegram")).TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await request.json().catch(() => null);
  const messages = telegramAdapter.normalizeWebhook(payload);
  if (!messages.length) return NextResponse.json({ ok: true, ignored: true });
  try {
    const results = await Promise.all(messages.map(saveIncomingMessage));
    return NextResponse.json({ ok: true, accepted: results.filter((item) => !item.duplicate).length });
  } catch {
    return NextResponse.json({ error: "Temporary processing error" }, { status: 503 });
  }
}
