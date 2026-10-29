import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { analyzeCallTranscript } from "@/lib/ai/service";
import { getCrmStateAsync, saveAiCallAnalysisAsync } from "@/lib/crm/store";
import { recordSecurityAuditSafe } from "@/lib/security/audit";

const schema = z.object({
  leadId: z.string().min(1),
  transcript: z.string().trim().min(30, "Расшифровка слишком короткая для анализа.").max(120000),
  recordingUrl: z.string().trim().url().max(2000).optional().or(z.literal(""))
});

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте расшифровку." }, { status: 400 });

  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  const lead = state.leads.find((item) => item.id === parsed.data.leadId);
  if (!user || !lead) return NextResponse.json({ error: "Лид или сотрудник не найден." }, { status: 404 });
  const canAccess = user.role === "Руководитель"
    || lead.ownerId === user.id;
  if (!canAccess) return NextResponse.json({ error: "Недостаточно прав для анализа этого лида." }, { status: 403 });

  try {
    const result = await analyzeCallTranscript(lead, parsed.data.transcript);
    const call = await saveAiCallAnalysisAsync({
      leadId: lead.id,
      ownerId: lead.ownerId,
      transcript: parsed.data.transcript,
      recordingUrl: parsed.data.recordingUrl || undefined,
      analysis: result.analysis
    });
    await recordSecurityAuditSafe(user, "ai.call_analyzed", "lead", lead.id, { provider: result.provider, model: result.model, callRecordId: call.id });
    return NextResponse.json({ call, analysis: result.analysis, provider: result.provider, model: result.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить AI-анализ.";
    return NextResponse.json({ error: message }, { status: /AI не настроен/.test(message) ? 503 : 424 });
  }
}
