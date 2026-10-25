import type { MessageAttachment, NormalizedIncomingMessage, ProviderAdapter } from "../types";
import { getMessengerSecrets } from "../secrets";
import { asArray, asRecord, asString, providerJson } from "./shared";

function graphUrl(version: string, path: string) {
  return `https://graph.instagram.com/${version}/${path}`;
}

async function configuration() {
  const secrets = await getMessengerSecrets("instagram");
  return {
    accessToken: secrets.INSTAGRAM_ACCESS_TOKEN,
    accountId: secrets.INSTAGRAM_ACCOUNT_ID,
    version: secrets.INSTAGRAM_GRAPH_VERSION || "v26.0"
  };
}

async function sendPayload(payload: Record<string, unknown>) {
  const { accessToken, accountId, version } = await configuration();
  if (!accessToken || !accountId) throw new Error("Instagram не настроен: добавьте Access Token и Instagram Account ID.");
  return providerJson(await fetch(graphUrl(version, `${accountId}/messages`), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }));
}

function attachmentFromMessage(message: Record<string, unknown>): MessageAttachment[] {
  return asArray(message.attachments).flatMap((item) => {
    const attachment = asRecord(item);
    const payload = asRecord(attachment?.payload);
    const url = asString(payload?.url);
    const rawType = asString(attachment?.type);
    const type = rawType === "image" || rawType === "video" || rawType === "audio" || rawType === "file" ? rawType : "unknown";
    return type === "unknown" ? [] : [{ type, url: url || undefined } as MessageAttachment];
  });
}

export const instagramAdapter: ProviderAdapter = {
  channel: "instagram",
  async isConfigured() {
    const { accessToken, accountId } = await configuration();
    return Boolean(accessToken && accountId);
  },
  async checkConnection() {
    const { accessToken, accountId, version } = await configuration();
    if (!accessToken || !accountId) return { ok: false, message: "Добавьте INSTAGRAM_ACCESS_TOKEN и INSTAGRAM_ACCOUNT_ID." };
    const data = await providerJson(await fetch(graphUrl(version, `${accountId}?fields=id,username,name`), {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store"
    }));
    const username = asString(data?.username);
    return {
      ok: true,
      externalAccountId: asString(data?.id) || accountId,
      externalAccountUsername: username || undefined,
      message: username ? `Instagram @${username} доступен.` : "Instagram Messaging API доступен."
    };
  },
  async configureWebhook() {
    const { accessToken, accountId, version } = await configuration();
    if (!accessToken || !accountId) throw new Error("Instagram не настроен.");
    await providerJson(await fetch(graphUrl(version, `${accountId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions`), {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}` }
    }));
  },
  async sendText(conversation, text) {
    const data = await sendPayload({ recipient: { id: conversation.externalContactId }, message: { text } });
    const externalMessageId = asString(data?.message_id);
    if (!externalMessageId) throw new Error("Instagram не вернул идентификатор сообщения.");
    return { externalMessageId, status: "sent" };
  },
  async sendMedia(conversation, attachment, caption) {
    const data = await sendPayload({
      recipient: { id: conversation.externalContactId },
      message: { attachment: { type: attachment.type, payload: { url: attachment.url } } }
    });
    const externalMessageId = asString(data?.message_id);
    if (!externalMessageId) throw new Error("Instagram не вернул идентификатор медиа-сообщения.");
    if (caption) await sendPayload({ recipient: { id: conversation.externalContactId }, message: { text: caption } });
    return { externalMessageId, status: "sent" };
  },
  normalizeWebhook(payload) {
    const root = asRecord(payload);
    const result: NormalizedIncomingMessage[] = [];
    asArray(root?.entry).forEach((entryValue) => {
      const entry = asRecord(entryValue);
      const accountId = asString(entry?.id);
      asArray(entry?.messaging).forEach((eventValue) => {
        const event = asRecord(eventValue);
        const sender = asRecord(event?.sender);
        const recipient = asRecord(event?.recipient);
        const message = asRecord(event?.message);
        const senderId = asString(sender?.id);
        const messageId = asString(message?.mid);
        if (!senderId || !messageId || Boolean(message?.is_echo)) return;
        const attachments = attachmentFromMessage(message ?? {});
        result.push({
          channel: "instagram",
          connectionId: "instagram",
          eventId: messageId,
          externalConversationId: senderId,
          externalContactId: senderId,
          botExternalAccountId: accountId || asString(recipient?.id) || undefined,
          externalMessageId: messageId,
          contactName: `Instagram ${senderId}`,
          username: senderId,
          text: asString(message?.text) || (attachments.length ? "Вложение Instagram" : "Событие Instagram"),
          sentAt: new Date(Number(event?.timestamp) || Date.now()).toISOString(),
          contentType: attachments[0]?.type ?? "text",
          attachments,
          metadata: { recipientId: asString(recipient?.id) || null }
        });
      });
    });
    return result;
  }
};
