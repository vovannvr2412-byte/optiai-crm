import { NextResponse } from "next/server";
import { runAutomationScheduler } from "@/lib/automations/scheduler";
import { processPendingRegistrations } from "@/lib/optiai/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET не настроен" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Недействительный ключ планировщика" }, { status: 401 });
  }
  try {
    const [automations, registrations] = await Promise.all([runAutomationScheduler(), processPendingRegistrations()]);
    return NextResponse.json({ ok: true, ...automations, registrations }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    console.error("Automation cron failed", error);
    return NextResponse.json({ error: "Планировщик завершился с ошибкой" }, { status: 500 });
  }
}
