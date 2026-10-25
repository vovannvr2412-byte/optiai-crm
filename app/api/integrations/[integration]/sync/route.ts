import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";
import { externalIntegrationSummary, isExternalIntegrationId, syncExternalIntegration } from "@/lib/external-integrations";

export async function POST(_request: Request, context: { params: Promise<{ integration: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user || (user.role !== "Руководитель" && user.role !== "РОП")) return NextResponse.json({ error: "Синхронизация доступна руководителю и РОП." }, { status: 403 });
  const { integration } = await context.params;
  if (!isExternalIntegrationId(integration)) return NextResponse.json({ error: "Неизвестная интеграция." }, { status: 404 });
  try {
    const result = await syncExternalIntegration(integration, user);
    return NextResponse.json({ integration: await externalIntegrationSummary(integration), result, message: result.message });
  } catch (error) {
    return NextResponse.json({ integration: await externalIntegrationSummary(integration), error: error instanceof Error ? error.message : "Синхронизация завершилась с ошибкой." }, { status: 502 });
  }
}
