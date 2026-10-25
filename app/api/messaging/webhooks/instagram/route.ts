import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { instagramAdapter } from "@/lib/messaging/providers/instagram";
import { getMessengerSecrets } from "@/lib/messaging/secrets";
import { saveIncomingMessageAndNotify } from "@/lib/messaging/incoming";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const verifyToken = (await getMessengerSecrets("instagram")).INSTAGRAM_VERIFY_TOKEN;
  if (url.searchParams.get("hub.mode") === "subscribe"
    && url.searchParams.get("hub.verify_token") === verifyToken
    && url.searchParams.get("hub.challenge")) {
    return new Response(url.searchParams.get("hub.challenge"), { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const secrets = await getMessengerSecrets("instagram");
  const raw = await request.text();
  if (!secrets.INSTAGRAM_APP_SECRET || !validSignature(raw, request.headers.get("x-hub-signature-256") ?? "", secrets.INSTAGRAM_APP_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = JSON.parse(raw) as unknown;
    const results = await Promise.all(instagramAdapter.normalizeWebhook(payload).map(saveIncomingMessageAndNotify));
    return NextResponse.json({ ok: true, accepted: results.filter((item) => !item.duplicate).length });
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
