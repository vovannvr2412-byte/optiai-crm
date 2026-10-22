import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeWhatsAppStatuses, whatsappAdapter } from "@/lib/messaging/providers/whatsapp";
import { saveIncomingMessage, updateMessageStatusByExternalId } from "@/lib/messaging/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!secret || !validSignature(raw, signature, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = JSON.parse(raw) as unknown;
  try {
    const messages = whatsappAdapter.normalizeWebhook(payload);
    const statuses = normalizeWhatsAppStatuses(payload);
    await Promise.all([
      ...messages.map(saveIncomingMessage),
      ...statuses.map((item) => updateMessageStatusByExternalId("whatsapp", item.externalMessageId, item.status, item.errorReason))
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Temporary processing error" }, { status: 503 });
  }
}

function validSignature(raw: string, signature: string, secret: string) {
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
