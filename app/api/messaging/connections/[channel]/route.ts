import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { getCrmStateAsync } from "@/lib/crm/store";
import { isMessengerChannel } from "@/lib/messaging/config";
import { deleteMessengerSecrets, messengerSecretFields, saveMessengerSecrets } from "@/lib/messaging/secrets";
import { listConnections, resetConnectionStatus } from "@/lib/messaging/store";
import { recordSecurityAuditSafe } from "@/lib/security/audit";

const schema = z.object({ config: z.record(z.string(), z.string().max(12000)) });

async function ownerFromSession() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const state = await getCrmStateAsync();
  return state.users.find((item) => item.id === userId && item.status === "active" && item.role === "Руководитель") ?? null;
}

export async function PUT(request: Request, context: { params: Promise<{ channel: string }> }) {
  const owner = await ownerFromSession();
  if (!owner) return NextResponse.json({ error: "Настройки ботов может менять только руководитель." }, { status: 403 });
  const { channel } = await context.params;
  if (!isMessengerChannel(channel)) return NextResponse.json({ error: "Неизвестный канал." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте значения полей." }, { status: 400 });
  const allowed = new Set(messengerSecretFields[channel]);
  const sanitized = Object.fromEntries(Object.entries(parsed.data.config).filter(([key]) => allowed.has(key)));
  try {
    await saveMessengerSecrets(channel, sanitized);
    await resetConnectionStatus(channel);
    const connection = (await listConnections()).find((item) => item.channel === channel);
    await recordSecurityAuditSafe(owner, "messenger.credentials_updated", "messenger_connection", channel, { fields: Object.keys(sanitized).sort() });
    return NextResponse.json({ connection, message: "Настройки сохранены в зашифрованном серверном хранилище." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить настройки." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ channel: string }> }) {
  const owner = await ownerFromSession();
  if (!owner) return NextResponse.json({ error: "Настройки ботов может менять только руководитель." }, { status: 403 });
  const { channel } = await context.params;
  if (!isMessengerChannel(channel)) return NextResponse.json({ error: "Неизвестный канал." }, { status: 404 });
  try {
    await deleteMessengerSecrets(channel);
    await resetConnectionStatus(channel);
    const connection = (await listConnections()).find((item) => item.channel === channel);
    await recordSecurityAuditSafe(owner, "messenger.credentials_deleted", "messenger_connection", channel);
    return NextResponse.json({ connection, message: "Настройки CRM удалены. Переменные Vercel, если они заданы, снова используются как резерв." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сбросить настройки." }, { status: 500 });
  }
}
