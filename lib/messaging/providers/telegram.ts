import type { MessageAttachment, OutgoingMediaAttachment, ProviderAdapter } from "../types";
import { getMessengerSecrets } from "../secrets";
import { asArray, asRecord, asString, providerJson, unixSecondsToIso } from "./shared";

async function token() {
  return (await getMessengerSecrets("telegram")).TELEGRAM_BOT_TOKEN;
}

export type TelegramBotProfile = {
  id: string;
  username?: string;
  displayName: string;
};

function apiUrl(botToken: string, method: string) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

export async function inspectTelegramBot(botToken: string): Promise<TelegramBotProfile> {
  if (!botToken.trim()) throw new Error("Добавьте TELEGRAM_BOT_TOKEN.");
  const data = await providerJson(await fetch(apiUrl(botToken.trim(), "getMe"), { cache: "no-store" }));
  const result = asRecord(data?.result);
  const id = asString(result?.id);
  if (data?.ok !== true || !id) throw new Error("Telegram не подтвердил токен нового бота.");
  const username = asString(result?.username);
  const displayName = [asString(result?.first_name), asString(result?.last_name)].filter(Boolean).join(" ") || (username ? `@${username}` : `Bot ${id}`);
  return { id, username: username || undefined, displayName };
}

export async function setTelegramWebhook(botToken: string, webhookUrl: string, webhookSecret: string) {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
    throw new Error("Webhook Secret должен содержать 1–256 символов: A-Z, a-z, 0-9, _ или -.");
  }
  const data = await providerJson(await fetch(apiUrl(botToken.trim(), "setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "edited_message"],
      drop_pending_updates: false
    })
  }));
  if (data?.ok !== true) throw new Error("Telegram не принял webhook нового бота.");
}

export async function deleteTelegramWebhook(botToken: string) {
  if (!botToken.trim()) return;
  const data = await providerJson(await fetch(apiUrl(botToken.trim(), "deleteWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drop_pending_updates: false })
  }));
  if (data?.ok !== true) throw new Error("Telegram не отключил webhook предыдущего бота.");
}

export async function downloadTelegramAttachment(botToken: string, attachment: MessageAttachment) {
  if (!botToken.trim() || !attachment.externalId) throw new Error("Медиафайл Telegram недоступен.");
  const data = await providerJson(await fetch(apiUrl(botToken.trim(), `getFile?file_id=${encodeURIComponent(attachment.externalId)}`), {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  }));
  const filePath = asString(asRecord(data?.result)?.file_path);
  if (!filePath) throw new Error("Telegram не вернул путь к файлу.");
  const response = await fetch(`https://api.telegram.org/file/bot${botToken.trim()}/${filePath}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("Telegram не отдал медиафайл.");
  return {
    body: await response.arrayBuffer(),
    mimeType: attachment.mimeType || response.headers.get("content-type") || "application/octet-stream",
    fileName: attachment.name
  };
}

async function mediaBlob(attachment: OutgoingMediaAttachment) {
  const response = await fetch(attachment.url, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось прочитать медиафайл для Telegram.");
  return response.blob();
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
  isConfigured: async () => Boolean(await token()),
  async checkConnection() {
    const botToken = await token();
    if (!botToken) return { ok: false, message: "Добавьте TELEGRAM_BOT_TOKEN." };
    const profile = await inspectTelegramBot(botToken);
    return {
      ok: true,
      externalAccountId: profile.id,
      externalAccountUsername: profile.username,
      message: profile.username ? `Бот @${profile.username} доступен.` : "Telegram Bot API доступен."
    };
  },
  async sendText(conversation, text) {
    if (conversation.needsReconnect) throw new Error("Клиент ещё не запустил нового Telegram-бота. Отправьте ему ссылку на бота и попросите нажать /start.");
    const botToken = await token();
    if (!botToken) throw new Error("Telegram не настроен: отсутствует TELEGRAM_BOT_TOKEN.");
    const data = await providerJson(await fetch(apiUrl(botToken, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: conversation.externalConversationId, text })
    }));
    const result = asRecord(data?.result);
    const externalMessageId = asString(result?.message_id);
    if (!externalMessageId) throw new Error("Telegram не вернул идентификатор сообщения.");
    return { externalMessageId: `${conversation.botExternalAccountId ?? "telegram"}:${externalMessageId}`, status: "sent" };
  },
  async sendMedia(conversation, attachment, caption) {
    if (conversation.needsReconnect) throw new Error("Клиент ещё не запустил нового Telegram-бота. Отправьте ему ссылку на бота и попросите нажать /start.");
    const botToken = await token();
    if (!botToken) throw new Error("Telegram не настроен: отсутствует TELEGRAM_BOT_TOKEN.");
    const field = attachment.type === "image" ? "photo" : "video";
    const form = new FormData();
    form.append("chat_id", conversation.externalConversationId);
    form.append(field, await mediaBlob(attachment), attachment.name || `${attachment.type}.${attachment.type === "image" ? "jpg" : "mp4"}`);
    if (caption) form.append("caption", caption);
    const data = await providerJson(await fetch(apiUrl(botToken, attachment.type === "image" ? "sendPhoto" : "sendVideo"), { method: "POST", body: form }));
    const externalMessageId = asString(asRecord(data?.result)?.message_id);
    if (!externalMessageId) throw new Error("Telegram не вернул идентификатор медиа-сообщения.");
    return { externalMessageId: `${conversation.botExternalAccountId ?? "telegram"}:${externalMessageId}`, status: "sent" };
  },
  async downloadAttachment(attachment) {
    const botToken = await token();
    return downloadTelegramAttachment(botToken, attachment);
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
