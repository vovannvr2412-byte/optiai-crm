import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";
import { isMessengerChannel, safeProviderError } from "@/lib/messaging/config";
import { providerFor } from "@/lib/messaging/providers";
import { saveConnectionCheck } from "@/lib/messaging/store";

export async function POST(_request: Request, context: { params: Promise<{ channel: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user || user.role !== "Руководитель") return NextResponse.json({ error: "Проверять подключения может руководитель." }, { status: 403 });
  const { channel } = await context.params;
  if (!isMessengerChannel(channel)) return NextResponse.json({ error: "Неизвестный канал." }, { status: 404 });
  try {
    const result = await providerFor(channel).checkConnection();
    const connection = await saveConnectionCheck(channel, result);
    return NextResponse.json({ connection, message: result.message }, { status: result.ok ? 200 : 424 });
  } catch (error) {
    const message = safeProviderError(error);
    const connection = await saveConnectionCheck(channel, { ok: false, message });
    return NextResponse.json({ connection, error: message }, { status: 502 });
  }
}
