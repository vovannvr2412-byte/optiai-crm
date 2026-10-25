import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";
import { deleteIntegrationSecrets } from "@/lib/integrations/secrets";
import { externalIntegrationSummary, isExternalIntegrationId, saveExternalIntegration } from "@/lib/external-integrations";

const schema = z.object({ config: z.record(z.string(), z.string().max(20000)) });

async function owner() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const state = await getCrmStateAsync();
  return state.users.find((item) => item.id === userId && item.status === "active" && item.role === "Руководитель") ?? null;
}

export async function GET(_request: Request, context: { params: Promise<{ integration: string }> }) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Настройки интеграций доступны руководителю." }, { status: 403 });
  const { integration } = await context.params;
  if (!isExternalIntegrationId(integration)) return NextResponse.json({ error: "Неизвестная интеграция." }, { status: 404 });
  return NextResponse.json({ integration: await externalIntegrationSummary(integration) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request, context: { params: Promise<{ integration: string }> }) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Настройки интеграций доступны руководителю." }, { status: 403 });
  const { integration } = await context.params;
  if (!isExternalIntegrationId(integration)) return NextResponse.json({ error: "Неизвестная интеграция." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте поля интеграции." }, { status: 400 });
  try {
    const result = await saveExternalIntegration(integration, parsed.data.config);
    const summary = await externalIntegrationSummary(integration);
    return NextResponse.json({ integration: summary, message: result.message, error: result.ok ? undefined : result.message }, { status: result.ok ? 200 : 424 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить интеграцию." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ integration: string }> }) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Настройки интеграций доступны руководителю." }, { status: 403 });
  const { integration } = await context.params;
  if (!isExternalIntegrationId(integration)) return NextResponse.json({ error: "Неизвестная интеграция." }, { status: 404 });
  await deleteIntegrationSecrets(integration);
  return NextResponse.json({ integration: await externalIntegrationSummary(integration), message: "Сохранённые ключи удалены." });
}
