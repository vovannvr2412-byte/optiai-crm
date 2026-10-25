import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeWhatsAppStatuses, whatsappAdapter } from "@/lib/messaging/providers/whatsapp";
import { updateMessageStatusByExternalId } from "@/lib/messaging/store";
import { saveIncomingMessageAndNotify } from "@/lib/messaging/incoming";
import { getMessengerSecrets } from "@/lib/messaging/secrets";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = (await getMessengerSecrets("whatsapp")).WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && challenge && token === verifyToken) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const secret = (await getMessengerSecrets("whatsapp")).WHATSAPP_APP_SECRET;
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!secret || !validSignature(raw, signature, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = JSON.parse(raw) as unknown;
  try {
    const messages = whatsappAdapter.normalizeWebhook(payload);
    const statuses = normalizeWhatsAppStatuses(payload);
    await Promise.all([
      ...messages.map(saveIncomingMessageAndNotify),
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
