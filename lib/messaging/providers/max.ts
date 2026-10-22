import type { MessageAttachment, ProviderAdapter } from "../types";
import { asArray, asRecord, asString, providerJson } from "./shared";

const apiBase = "https://platform-api2.max.ru";

function token() {
  return process.env.MAX_BOT_TOKEN?.trim() ?? "";
}

function authHeaders() {
  return { Authorization: token(), "Content-Type": "application/json" };
}

function parseAttachments(message: Record<string, unknown>) {
  return asArray(message.attachments).map((item): MessageAttachment | null => {
    const attachment = asRecord(item);
    const type = asString(attachment?.type);
    if (!["image", "video", "audio", "file", "location"].includes(type)) return null;
    const payload = asRecord(attachment?.payload);
    return { type: type as MessageAttachment["type"], externalId: asString(payload?.token) || asString(payload?.id) || undefined, name: asString(payload?.name) || undefined };
  }).filter(Boolean) as MessageAttachment[];
}

export const maxAdapter: ProviderAdapter = {
  channel: "max",
  isConfigured: () => Boolean(token()),
  async checkConnection() {
    if (!token()) return { ok: false, message: "Добавьте MAX_BOT_TOKEN." };
    const data = await providerJson(await fetch(`${apiBase}/me`, { headers: authHeaders(), cache: "no-store" }));
    const accountId = asString(data?.user_id) || asString(data?.id);
    const name = asString(data?.name) || asString(data?.username);
    return { ok: true, externalAccountId: accountId || undefined, message: name ? `Бот ${name} доступен.` : "MAX Bot API доступен." };
  },
  async sendText(conversation, text) {
    if (!token()) throw new Error("MAX не настроен: отсутствует MAX_BOT_TOKEN.");
    const queryKey = /^-?\d+$/.test(conversation.externalConversationId) ? "user_id" : "chat_id";
    const url = new URL(`${apiBase}/messages`);
    url.searchParams.set(queryKey, conversation.externalConversationId);
    const data = await providerJson(await fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ text })
    }));
    const message = asRecord(data?.message) ?? data;
    const body = asRecord(message?.body);
    const externalMessageId = asString(message?.mid) || asString(body?.mid) || asString(message?.id);
    if (!externalMessageId) throw new Error("MAX не вернул идентификатор сообщения.");
    return { externalMessageId, status: "sent" };
  },
  normalizeWebhook(payload) {
    const update = asRecord(payload);
    if (!update || asString(update.update_type) !== "message_created") return [];
    const message = asRecord(update.message);
    const body = asRecord(message?.body);
    const sender = asRecord(message?.sender);
    const recipient = asRecord(message?.recipient);
    const externalMessageId = asString(body?.mid) || asString(message?.mid) || asString(message?.id);
    const externalContactId = asString(sender?.user_id) || asString(sender?.id);
    const externalConversationId = asString(recipient?.chat_id) || externalContactId;
    if (!message || !externalMessageId || !externalConversationId) return [];
    const media = parseAttachments(message);
    const eventId = asString(update.timestamp) ? `${asString(update.update_type)}:${externalMessageId}:${asString(update.timestamp)}` : externalMessageId;
    const timestamp = Number(update.timestamp);
    return [{
      channel: "max",
      connectionId: "max",
      eventId,
      externalConversationId,
      externalContactId: externalContactId || externalConversationId,
      externalMessageId,
      contactName: asString(sender?.name) || asString(sender?.username) || "Контакт MAX",
      username: asString(sender?.username) || undefined,
      text: asString(body?.text) || (media.length ? "Вложение" : "Неподдерживаемое сообщение"),
      sentAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
      contentType: media[0]?.type ?? "text",
      attachments: media,
      metadata: { updateType: asString(update.update_type), chatId: asString(recipient?.chat_id) || null }
    }];
  }
};
