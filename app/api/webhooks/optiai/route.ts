import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { processOptiaiEvent } from "@/lib/optiai/events";
import { getIntegrationSecrets } from "@/lib/integrations/secrets";

export const runtime = "nodejs";
const schema = z.object({
  event_id: z.string().min(1).max(300),
  type: z.enum(["setup_requested", "manager_call_requested", "account_registered", "payment_succeeded", "account_connected", "subscription_expired", "subscription_renewed", "document_synced"]),
  occurred_at: z.string().datetime(),
  data: z.record(z.string(), z.unknown())
});

export async function POST(request: Request) {
  const configured: Record<string, string> = await getIntegrationSecrets("optiai").catch(() => ({}));
  const secret = configured.webhookSecret?.trim() || process.env.OPTIAI_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "OPTIAI_WEBHOOK_SECRET не настроен" }, { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-optiai-signature")?.replace(/^sha256=/, "") ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return NextResponse.json({ error: "Недействительная подпись" }, { status: 401 });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Некорректное событие OptiAI" }, { status: 400 });
  try {
    const result = await processOptiaiEvent({ eventId: parsed.data.event_id, type: parsed.data.type, occurredAt: parsed.data.occurred_at, data: parsed.data.data });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("OptiAI webhook failed", error);
    return NextResponse.json({ error: "Событие сохранено, но обработка не завершена" }, { status: 500 });
  }
}
