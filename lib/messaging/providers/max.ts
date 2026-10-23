import type { MessageAttachment, ProviderAdapter } from "../types";
import { getMessengerSecrets } from "../secrets";
import { asArray, asRecord, asString, providerJson } from "./shared";

const apiBase = "https://platform-api2.max.ru";

async function token() {
  return (await getMessengerSecrets("max")).MAX_BOT_TOKEN;
}

function authHeaders(botToken: string) {
  return { Authorization: botToken, "Content-Type": "application/json" };
}

function destinationUrl(externalConversationId: string) {
  const queryKey = /^-?\d+$/.test(externalConversationId) ? "user_id" : "chat_id";
  const url = new URL(`${apiBase}/messages`);
  url.searchParams.set(queryKey, externalConversationId);
  return url;
}

function parseAttachments(message: Record<string, unknown>) {
  return asArray(message.attachments).map((item): MessageAttachment | null => {
    const attachment = asRecord(item);
    const type = asString(attachment?.type);
    if (!["image", "video", "audio", "file", "location"].includes(type)) return null;
    const payload = asRecord(attachment?.payload);
    return {
      type: type as MessageAttachment["type"],
      externalId: asString(payload?.token) || asString(payload?.id) || undefined,
      url: asString(payload?.url) || asString(payload?.photo_url) || asString(payload?.video_url) || undefined,
      name: asString(payload?.name) || undefined,
      mimeType: asString(payload?.mime_type) || undefined
    };
  }).filter(Boolean) as MessageAttachment[];
}

export const maxAdapter: ProviderAdapter = {
  channel: "max",
  isConfigured: async () => Boolean(await token()),
  async checkConnection() {
    const botToken = await token();
    if (!botToken) return { ok: false, message: "Добавьте MAX_BOT_TOKEN." };
    const data = await providerJson(await fetch(`${apiBase}/me`, { headers: authHeaders(botToken), cache: "no-store" }));
    const accountId = asString(data?.user_id) || asString(data?.id);
    const name = asString(data?.name) || asString(data?.username);
    return { ok: true, externalAccountId: accountId || undefined, message: name ? `Бот ${name} доступен.` : "MAX Bot API доступен." };
  },
  async sendText(conversation, text) {
    const botToken = await token();
    if (!botToken) throw new Error("MAX не настроен: отсутствует MAX_BOT_TOKEN.");
    const data = await providerJson(await fetch(destinationUrl(conversation.externalConversationId), {
      method: "POST",
      headers: authHeaders(botToken),
      body: JSON.stringify({ text })
    }));
    const message = asRecord(data?.message) ?? data;
    const body = asRecord(message?.body);
    const externalMessageId = asString(message?.mid) || asString(body?.mid) || asString(message?.id);
    if (!externalMessageId) throw new Error("MAX не вернул идентификатор сообщения.");
    return { externalMessageId, status: "sent" };
  },
  async sendMedia(conversation, attachment, caption) {
    const botToken = await token();
    if (!botToken) throw new Error("MAX не настроен: отсутствует MAX_BOT_TOKEN.");
    const ticketUrl = new URL(`${apiBase}/uploads`);
    ticketUrl.searchParams.set("type", attachment.type);
    const ticket = await providerJson(await fetch(ticketUrl, { method: "POST", headers: { Authorization: botToken, Accept: "application/json" } }));
    const uploadUrl = asString(ticket?.url);
    const mediaToken = asString(ticket?.token);
    if (!uploadUrl || !mediaToken) throw new Error("MAX не подготовил загрузку медиафайла.");
    const source = await fetch(attachment.url, { cache: "no-store" });
    if (!source.ok) throw new Error("Не удалось прочитать медиафайл для MAX.");
    const form = new FormData();
    form.append("data", await source.blob(), attachment.name || `${attachment.type}.${attachment.type === "image" ? "jpg" : "mp4"}`);
    const uploaded = await fetch(uploadUrl, { method: "POST", body: form });
    if (!uploaded.ok) throw new Error("MAX не принял медиафайл.");
    const data = await providerJson(await fetch(destinationUrl(conversation.externalConversationId), {
      method: "POST",
      headers: authHeaders(botToken),
      body: JSON.stringify({ text: caption || undefined, attachments: [{ type: attachment.type, payload: { token: mediaToken } }] })
    }));
    const message = asRecord(data?.message) ?? data;
    const body = asRecord(message?.body);
    const externalMessageId = asString(message?.mid) || asString(body?.mid) || asString(message?.id);
    if (!externalMessageId) throw new Error("MAX не вернул идентификатор медиа-сообщения.");
    return { externalMessageId, status: "sent" };
  },
  async downloadAttachment(attachment) {
    if (!attachment.url) throw new Error("MAX не передал ссылку на медиафайл.");
    const response = await fetch(attachment.url, { cache: "no-store" });
    if (!response.ok) throw new Error("MAX не отдал медиафайл.");
    return { body: await response.arrayBuffer(), mimeType: attachment.mimeType || response.headers.get("content-type") || "application/octet-stream", fileName: attachment.name };
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
    const media = parseAttachments(body ?? message);
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
