import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { applyCrmActionAsync, getCrmStateAsync } from "@/lib/crm/store";
import { getIntegrationSecrets } from "@/lib/integrations/secrets";

export const runtime = "nodejs";
const schema = z.object({
  event_id: z.string().min(1).max(300),
  phone: z.string().min(5).max(60),
  result: z.enum(["answered", "no_answer", "busy", "invalid_number", "other"]),
  duration_seconds: z.number().int().min(0).max(86400),
  recording_url: z.string().url().optional(),
  owner_id: z.string().uuid().optional()
});

export async function POST(request: Request) {
  const configured: Record<string, string> = await getIntegrationSecrets("sip").catch(() => ({}));
  const secret = configured.webhookSecret?.trim() || process.env.SIP_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "SIP webhook secret не настроен" }, { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-sip-signature")?.replace(/^sha256=/, "") ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return NextResponse.json({ error: "Недействительная подпись" }, { status: 401 });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Некорректное событие звонка" }, { status: 400 });
  const state = await getCrmStateAsync();
  const phone = parsed.data.phone.replace(/\D/g, "");
  const lead = state.leads.find((item) => item.phone.replace(/\D/g, "") === phone);
  if (!lead) return NextResponse.json({ error: "Лид с таким номером не найден" }, { status: 404 });
  const ownerId = parsed.data.owner_id && state.users.some((user) => user.id === parsed.data.owner_id) ? parsed.data.owner_id : lead.ownerId;
  await applyCrmActionAsync({ type: "import_sip_call", payload: { externalId: parsed.data.event_id, leadId: lead.id, ownerId, result: parsed.data.result, durationSeconds: parsed.data.duration_seconds, recordingUrl: parsed.data.recording_url } });
  return NextResponse.json({ ok: true, leadId: lead.id });
}
