import type { MessageAttachment, ProviderAdapter } from "../types";
import { asArray, asRecord, asString, providerJson, unixSecondsToIso } from "./shared";

function token() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
}

function apiUrl(method: string) {
  return `https://api.telegram.org/bot${token()}/${method}`;
}

function content(message: Record<string, unknown>) {
  const attachments: MessageAttachment[] = [];
  const photos = asArray(message.photo);
  if (photos.length) {
    const photo = asRecord(photos.at(-1));
    attachments.push({ type: "image", externalId: asString(photo?.file_id) });
  }
  const document = asRecord(message.document);
  if (document) attachments.push({ type: "file", externalId: asString(document.file_id), name: asString(document.file_name), mimeType: asString(document.mime_type) });
  const audio = asRecord(message.audio) ?? asRecord(message.voice);
  if (audio) attachments.push({ type: "audio", externalId: asString(audio.file_id), mimeType: asString(audio.mime_type) });
  const video = asRecord(message.video);
  if (video) attachments.push({ type: "video", externalId: asString(video.file_id), mimeType: asString(video.mime_type) });
  const location = asRecord(message.location);
  if (location) attachments.push({ type: "location" });

  return {
    text: asString(message.text) || asString(message.caption) || (attachments.length ? "Вложение" : "Неподдерживаемое сообщение"),
    contentType: attachments[0]?.type ?? "text" as const,
    attachments
  };
}

export const telegramAdapter: ProviderAdapter = {
  channel: "telegram",
  isConfigured: () => Boolean(token()),
  async checkConnection() {
    if (!token()) return { ok: false, message: "Добавьте TELEGRAM_BOT_TOKEN." };
    const data = await providerJson(await fetch(apiUrl("getMe"), { cache: "no-store" }));
    const result = asRecord(data?.result);
    return {
      ok: data?.ok === true,
      externalAccountId: asString(result?.id),
      message: result?.username ? `Бот @${asString(result.username)} доступен.` : "Telegram Bot API доступен."
    };
  },
  async sendText(conversation, text) {
    if (!token()) throw new Error("Telegram не настроен: отсутствует TELEGRAM_BOT_TOKEN.");
    const data = await providerJson(await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: conversation.externalConversationId, text })
    }));
    const result = asRecord(data?.result);
    const externalMessageId = asString(result?.message_id);
    if (!externalMessageId) throw new Error("Telegram не вернул идентификатор сообщения.");
    return { externalMessageId, status: "sent" };
  },
  normalizeWebhook(payload) {
    const update = asRecord(payload);
    const message = asRecord(update?.message) ?? asRecord(update?.edited_message);
    const eventId = asString(update?.update_id);
    if (!message || !eventId) return [];
    const chat = asRecord(message.chat);
    const sender = asRecord(message.from);
    const externalConversationId = asString(chat?.id);
    const externalMessageId = asString(message.message_id);
    if (!externalConversationId || !externalMessageId) return [];
    const firstName = asString(sender?.first_name);
    const lastName = asString(sender?.last_name);
    const username = asString(sender?.username);
    const parsed = content(message);
    return [{
      channel: "telegram",
      connectionId: "telegram",
      eventId,
      externalConversationId,
      externalContactId: asString(sender?.id) || externalConversationId,
      externalMessageId,
      contactName: [firstName, lastName].filter(Boolean).join(" ") || (username ? `@${username}` : "Контакт Telegram"),
      username: username ? `@${username}` : undefined,
      text: parsed.text,
      sentAt: unixSecondsToIso(message.date),
      contentType: parsed.contentType,
      attachments: parsed.attachments,
      metadata: { updateId: eventId, chatType: asString(chat?.type) || null }
    }];
  }
};
