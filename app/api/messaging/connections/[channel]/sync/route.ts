import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync, setIntegrationStatusAsync } from "@/lib/crm/store";
import { isMessengerChannel, safeProviderError } from "@/lib/messaging/config";
import { providerFor } from "@/lib/messaging/providers";
import { saveIncomingMessageAndNotify } from "@/lib/messaging/incoming";
import { saveConnectionCheck } from "@/lib/messaging/store";

export async function POST(_request: Request, context: { params: Promise<{ channel: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user || user.role !== "Руководитель") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  const { channel } = await context.params;
  if (!isMessengerChannel(channel)) return NextResponse.json({ error: "Неизвестный канал." }, { status: 404 });
  const adapter = providerFor(channel);
  if (!adapter.pullIncoming) return NextResponse.json({ error: "Этот канал получает историю через webhook и не поддерживает ручной импорт." }, { status: 409 });
  try {
    const messages = await adapter.pullIncoming();
    const results = [];
    for (const message of messages) results.push(await saveIncomingMessageAndNotify(message));
    const health = await adapter.checkConnection();
    const connection = await saveConnectionCheck(channel, health);
    await setIntegrationStatusAsync(channel, health.ok ? "connected" : "error");
    return NextResponse.json({ connection, read: messages.length, imported: results.filter((item) => !item.duplicate).length });
  } catch (error) {
    const message = safeProviderError(error);
    await saveConnectionCheck(channel, { ok: false, message });
    await setIntegrationStatusAsync(channel, "error");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
