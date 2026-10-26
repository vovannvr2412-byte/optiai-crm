import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync, setIntegrationStatusAsync } from "@/lib/crm/store";
import { aiConfigurationInputSchema, aiConfigurationSummary, checkAiConnection, deleteAiConfiguration, saveAiConfiguration } from "@/lib/ai/service";
import { recordSecurityAuditSafe } from "@/lib/security/audit";

async function owner() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const state = await getCrmStateAsync();
  return state.users.find((user) => user.id === userId && user.status === "active" && user.role === "Руководитель") ?? null;
}

export async function GET() {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Настройки AI доступны руководителю." }, { status: 403 });
  return NextResponse.json({ configuration: await aiConfigurationSummary() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Настройки AI доступны руководителю." }, { status: 403 });
  const parsed = aiConfigurationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте настройки AI." }, { status: 400 });
  try {
    await saveAiConfiguration(parsed.data);
    const result = await checkAiConnection();
    await recordSecurityAuditSafe(user, "ai.configuration_updated", "integration", "ai", { provider: parsed.data.provider, model: parsed.data.model });
    return NextResponse.json({ configuration: await aiConfigurationSummary(), message: result.message });
  } catch (error) {
    await setIntegrationStatusAsync("ai", "error").catch(() => undefined);
    return NextResponse.json({ configuration: await aiConfigurationSummary(), error: error instanceof Error ? error.message : "Не удалось проверить AI." }, { status: 424 });
  }
}

export async function POST() {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Проверять AI может руководитель." }, { status: 403 });
  try {
    const result = await checkAiConnection();
    await recordSecurityAuditSafe(user, "ai.connection_checked", "integration", "ai");
    return NextResponse.json({ configuration: await aiConfigurationSummary(), message: result.message });
  } catch (error) {
    await setIntegrationStatusAsync("ai", "error").catch(() => undefined);
    return NextResponse.json({ configuration: await aiConfigurationSummary(), error: error instanceof Error ? error.message : "AI недоступен." }, { status: 424 });
  }
}

export async function DELETE() {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Настройки AI доступны руководителю." }, { status: 403 });
  try {
    await deleteAiConfiguration();
    await recordSecurityAuditSafe(user, "ai.configuration_deleted", "integration", "ai");
    return NextResponse.json({ configuration: await aiConfigurationSummary(), message: "Ключ и настройки AI удалены." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить настройки AI." }, { status: 500 });
  }
}
