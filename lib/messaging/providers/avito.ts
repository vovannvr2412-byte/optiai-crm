import type { MessageAttachment, NormalizedIncomingMessage, ProviderAdapter } from "../types";
import { getMessengerSecrets } from "../secrets";
import { asArray, asRecord, asString, providerJson, unixSecondsToIso } from "./shared";

const apiBase = "https://api.avito.ru";
let tokenCache: { key: string; accessToken: string; expiresAt: number } | null = null;

async function credentials() {
  const secrets = await getMessengerSecrets("avito");
  return {
    clientId: secrets.AVITO_CLIENT_ID,
    clientSecret: secrets.AVITO_CLIENT_SECRET,
    configuredUserId: secrets.AVITO_USER_ID
  };
}

async function accessToken() {
  const { clientId, clientSecret } = await credentials();
  if (!clientId || !clientSecret) throw new Error("Avito не настроен: добавьте Client ID и Client Secret.");
  const key = `${clientId}:${clientSecret}`;
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  const data = await providerJson(await fetch(`${apiBase}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body
  }));
  const token = asString(data?.access_token);
  if (!token) throw new Error("Avito не вернул access token.");
  tokenCache = { key, accessToken: token, expiresAt: Date.now() + Math.max(300, Number(data?.expires_in) || 86_400) * 1000 };
  return token;
}

async function avitoFetch(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  return providerJson(await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.headers ?? {}) },
    cache: "no-store"
  }));
}

async function account() {
  const configured = (await credentials()).configuredUserId;
  const data = await avitoFetch("/core/v1/accounts/self");
  const id = configured || asString(data?.id);
  if (!id) throw new Error("Avito не вернул ID аккаунта.");
  return { id, name: asString(data?.name) || asString(data?.email) || `Avito ${id}` };
}

function messageBody(message: Record<string, unknown>) {
  const content = asRecord(message.content);
  return asString(content?.text) || imageUrl(content?.image) || asString(content?.link) || `Сообщение Avito: ${asString(message.type) || "unknown"}`;
}

function imageUrl(value: unknown) {
  const direct = asString(value);
  if (direct) return direct;
  const image = asRecord(value);
  const sizes = asRecord(image?.sizes) ?? image;
  return sizes ? Object.values(sizes).map(asString).find(Boolean) || "" : "";
}

function normalizeAvitoMessage(message: Record<string, unknown>, chatId: string, accountId: string): NormalizedIncomingMessage | null {
  const authorId = asString(message.author_id) || asString(asRecord(message.author)?.id);
  const id = asString(message.id);
  if (!id || !authorId || authorId === accountId || asString(message.direction) === "out") return null;
  const created = message.created;
  const sentAt = typeof created === "string" && /T/.test(created) ? new Date(created).toISOString() : unixSecondsToIso(created);
  const type = asString(message.type);
  const content = asRecord(message.content);
  const attachments: MessageAttachment[] = [];
  if (type === "image") attachments.push({ type: "image", url: imageUrl(content?.image) || undefined });
  if (type === "voice") attachments.push({ type: "audio", externalId: asString(content?.voice) || undefined });
  return {
    channel: "avito", connectionId: "avito", eventId: id,
    externalConversationId: chatId, externalContactId: authorId, externalMessageId: id,
    contactName: asString(asRecord(message.author)?.name) || `Avito ${authorId}`,
    text: messageBody(message), sentAt, contentType: attachments[0]?.type ?? "text", attachments,
    metadata: { avitoAccountId: accountId, messageType: type || null }
  };
}

export const avitoAdapter: ProviderAdapter = {
  channel: "avito",
  async isConfigured() {
    const { clientId, clientSecret } = await credentials();
    return Boolean(clientId && clientSecret);
  },
  async checkConnection() {
    const profile = await account();
    return { ok: true, externalAccountId: profile.id, externalAccountUsername: profile.name, message: `Аккаунт ${profile.name} доступен.` };
  },
  async configureWebhook(webhookUrl) {
    await avitoFetch("/messenger/v3/webhook", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: webhookUrl })
    });
  },
  async sendText(conversation, text) {
    const profile = await account();
    const data = await avitoFetch(`/messenger/v1/accounts/${encodeURIComponent(profile.id)}/chats/${encodeURIComponent(conversation.externalConversationId)}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { text }, type: "text" })
    });
    const externalMessageId = asString(data?.id) || asString(asRecord(data?.message)?.id);
    if (!externalMessageId) throw new Error("Avito не вернул идентификатор сообщения.");
    return { externalMessageId, status: "sent" };
  },
  async sendMedia(conversation, attachment, caption) {
    if (attachment.type !== "image") throw new Error("Avito Messenger API поддерживает отправку изображений, но не видео.");
    const profile = await account();
    const source = await fetch(attachment.url, { cache: "no-store" });
    if (!source.ok) throw new Error("Не удалось прочитать изображение для Avito.");
    const form = new FormData();
    form.append("uploadfile[]", await source.blob(), attachment.name || "image.jpg");
    const uploaded = await avitoFetch(`/messenger/v1/accounts/${encodeURIComponent(profile.id)}/uploadImages`, { method: "POST", body: form });
    const images = asRecord(uploaded?.images) ?? uploaded;
    const firstEntry = images ? Object.entries(images)[0] : undefined;
    const imageId = asString(asRecord(firstEntry?.[1])?.id) || firstEntry?.[0] || "";
    if (!imageId) throw new Error("Avito не вернул идентификатор изображения.");
    const data = await avitoFetch(`/messenger/v1/accounts/${encodeURIComponent(profile.id)}/chats/${encodeURIComponent(conversation.externalConversationId)}/messages/image`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_id: imageId })
    });
    if (caption) await this.sendText(conversation, caption);
    const externalMessageId = asString(data?.id) || asString(asRecord(data?.message)?.id);
    if (!externalMessageId) throw new Error("Avito не вернул идентификатор сообщения с изображением.");
    return { externalMessageId, status: "sent" };
  },
  async pullIncoming() {
    const profile = await account();
    const chatsData = await avitoFetch(`/messenger/v2/accounts/${encodeURIComponent(profile.id)}/chats?limit=100&offset=0`);
    const chats = asArray(chatsData?.chats);
    const result: NormalizedIncomingMessage[] = [];
    for (const chatValue of chats) {
      const chat = asRecord(chatValue);
      const chatId = asString(chat?.id);
      if (!chatId) continue;
      const messagesData = await avitoFetch(`/messenger/v3/accounts/${encodeURIComponent(profile.id)}/chats/${encodeURIComponent(chatId)}/messages/?limit=100&offset=0`);
      for (const messageValue of asArray(messagesData?.messages)) {
        const normalized = normalizeAvitoMessage(asRecord(messageValue) ?? {}, chatId, profile.id);
        if (normalized) result.push(normalized);
      }
    }
    return result;
  },
  normalizeWebhook(payload) {
    const root = asRecord(payload);
    const value = asRecord(root?.payload) ?? root;
    const message = asRecord(value?.value) ?? asRecord(value?.message) ?? value;
    const chatId = asString(value?.chat_id) || asString(asRecord(value?.chat)?.id) || asString(message?.chat_id);
    const accountId = asString(value?.user_id) || asString(root?.user_id) || asString(message?.account_id);
    if (!chatId || !message) return [];
    const normalized = normalizeAvitoMessage(message, chatId, accountId);
    return normalized ? [normalized] : [];
  }
};
