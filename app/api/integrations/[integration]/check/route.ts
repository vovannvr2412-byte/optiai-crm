import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync, setIntegrationStatusAsync } from "@/lib/crm/store";
import { checkExternalIntegration, externalIntegrationSummary, isExternalIntegrationId } from "@/lib/external-integrations";

export async function POST(_request: Request, context: { params: Promise<{ integration: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user || user.role !== "Руководитель") return NextResponse.json({ error: "Проверять интеграции может руководитель." }, { status: 403 });
  const { integration } = await context.params;
  if (!isExternalIntegrationId(integration)) return NextResponse.json({ error: "Неизвестная интеграция." }, { status: 404 });
  try {
    const result = await checkExternalIntegration(integration);
    await setIntegrationStatusAsync(integration, result.ok ? "connected" : "error");
    return NextResponse.json({ integration: await externalIntegrationSummary(integration), message: result.message, error: result.ok ? undefined : result.message }, { status: result.ok ? 200 : 424 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Проверка интеграции завершилась с ошибкой.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
