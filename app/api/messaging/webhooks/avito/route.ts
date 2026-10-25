import { NextResponse } from "next/server";
import { avitoAdapter } from "@/lib/messaging/providers/avito";
import { getMessengerSecrets } from "@/lib/messaging/secrets";
import { saveIncomingMessageAndNotify } from "@/lib/messaging/incoming";

export async function POST(request: Request) {
  const expected = (await getMessengerSecrets("avito")).AVITO_WEBHOOK_SECRET;
  const received = new URL(request.url).searchParams.get("secret") || request.headers.get("x-optiai-webhook-secret");
  if (!expected || received !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await request.json().catch(() => null);
  try {
    const results = await Promise.all(avitoAdapter.normalizeWebhook(payload).map(saveIncomingMessageAndNotify));
    return NextResponse.json({ ok: true, accepted: results.filter((item) => !item.duplicate).length });
  } catch {
    return NextResponse.json({ error: "Temporary processing error" }, { status: 503 });
  }
}
