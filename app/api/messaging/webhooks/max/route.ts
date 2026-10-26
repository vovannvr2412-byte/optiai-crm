import { after, NextResponse } from "next/server";
import { processIncomingAiReply } from "@/lib/ai/messaging";
import { maxAdapter } from "@/lib/messaging/providers/max";
import { saveIncomingMessageAndNotify } from "@/lib/messaging/incoming";
import { getMessengerSecrets } from "@/lib/messaging/secrets";

export const maxDuration = 120;

export async function POST(request: Request) {
  const secret = (await getMessengerSecrets("max")).MAX_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-max-bot-api-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await request.json().catch(() => null);
  const messages = maxAdapter.normalizeWebhook(payload);
  if (!messages.length) return NextResponse.json({ ok: true, ignored: true });
  try {
    const results = await Promise.all(messages.map(saveIncomingMessageAndNotify));
    after(() => Promise.all(results.map(processIncomingAiReply)).then(() => undefined));
    return NextResponse.json({ ok: true, accepted: results.filter((item) => !item.duplicate).length });
  } catch {
    return NextResponse.json({ error: "Temporary processing error" }, { status: 503 });
  }
}
