import type { MessageAttachment, MessageDeliveryStatus, NormalizedIncomingMessage, ProviderAdapter } from "../types";
import { getMessengerSecrets } from "../secrets";
import { asArray, asRecord, asString, providerJson, unixSecondsToIso } from "./shared";

function graphUrl(version: string, path: string) {
  return `https://graph.facebook.com/${version}/${path}`;
}

function messageText(message: Record<string, unknown>) {
  const type = asString(message.type);
  const payload = asRecord(message[type]);
  if (type === "text") return asString(payload?.body);
  if (type === "button") return asString(payload?.text) || asString(payload?.payload);
  if (type === "interactive") {
    const button = asRecord(payload?.button_reply);
    const list = asRecord(payload?.list_reply);
    return asString(button?.title) || asString(list?.title) || "Интерактивный ответ";
  }
  return type ? `Вложение: ${type}` : "Неподдерживаемое сообщение";
}

function attachments(message: Record<string, unknown>): MessageAttachment[] {
  const type = asString(message.type);
  if (!["image", "video", "audio", "document", "location"].includes(type)) return [];
  const payload = asRecord(message[type]);
  const mappedType = type === "document" ? "file" : type;
  return [{
    type: mappedType as MessageAttachment["type"],
    externalId: asString(payload?.id) || undefined,
    name: asString(payload?.filename) || undefined,
    mimeType: asString(payload?.mime_type) || undefined
  }];
}

function values(payload: unknown) {
  const root = asRecord(payload);
  return asArray(root?.entry).flatMap((entry) => {
    const record = asRecord(entry);
    return asArray(record?.changes).map((change) => asRecord(asRecord(change)?.value)).filter(Boolean) as Record<string, unknown>[];
  });
}

export type WhatsAppStatusUpdate = { externalMessageId: string; status: MessageDeliveryStatus; errorReason?: string };

export function normalizeWhatsAppStatuses(payload: unknown): WhatsAppStatusUpdate[] {
  const allowed: Record<string, MessageDeliveryStatus> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
  return values(payload).flatMap((value) => asArray(value.statuses).map((item) => {
    const status = asRecord(item);
    const errors = asArray(status?.errors);
    const firstError = asRecord(errors[0]);
    return {
      externalMessageId: asString(status?.id),
      status: allowed[asString(status?.status)] ?? "sent",
      errorReason: asString(firstError?.title) || asString(firstError?.message) || undefined
    };
  })).filter((item) => item.externalMessageId);
}

export const whatsappAdapter: ProviderAdapter = {
  channel: "whatsapp",
  isConfigured: async () => {
    const secrets = await getMessengerSecrets("whatsapp");
    return Boolean(secrets.WHATSAPP_ACCESS_TOKEN && secrets.WHATSAPP_PHONE_NUMBER_ID);
  },
  async checkConnection() {
    const secrets = await getMessengerSecrets("whatsapp");
    const accessToken = secrets.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = secrets.WHATSAPP_PHONE_NUMBER_ID;
    const version = secrets.WHATSAPP_GRAPH_VERSION || "v24.0";
    if (!accessToken || !phoneNumberId) return { ok: false, message: "Добавьте WHATSAPP_ACCESS_TOKEN и WHATSAPP_PHONE_NUMBER_ID." };
    const data = await providerJson(await fetch(graphUrl(version, `${phoneNumberId}?fields=id,display_phone_number,verified_name`), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store"
    }));
    const label = asString(data?.verified_name) || asString(data?.display_phone_number) || phoneNumberId;
    return { ok: true, externalAccountId: asString(data?.id) || phoneNumberId, message: `Номер ${label} доступен.` };
  },
  async sendText(conversation, text) {
    const secrets = await getMessengerSecrets("whatsapp");
    const accessToken = secrets.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = secrets.WHATSAPP_PHONE_NUMBER_ID;
    const version = secrets.WHATSAPP_GRAPH_VERSION || "v24.0";
    if (!accessToken || !phoneNumberId) throw new Error("WhatsApp не настроен: отсутствуют серверные переменные Cloud API.");
    const data = await providerJson(await fetch(graphUrl(version, `${phoneNumberId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: conversation.externalConversationId, type: "text", text: { preview_url: false, body: text } })
    }));
    const message = asRecord(asArray(data?.messages)[0]);
    const externalMessageId = asString(message?.id);
    if (!externalMessageId) throw new Error("WhatsApp не вернул идентификатор сообщения.");
    return { externalMessageId, status: "sent" };
  },
  async sendMedia(conversation, attachment, caption) {
    const secrets = await getMessengerSecrets("whatsapp");
    const accessToken = secrets.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = secrets.WHATSAPP_PHONE_NUMBER_ID;
    const version = secrets.WHATSAPP_GRAPH_VERSION || "v24.0";
    if (!accessToken || !phoneNumberId) throw new Error("WhatsApp не настроен: отсутствуют серверные переменные Cloud API.");
    const source = await fetch(attachment.url, { cache: "no-store" });
    if (!source.ok) throw new Error("Не удалось прочитать медиафайл для WhatsApp.");
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", attachment.mimeType || (attachment.type === "image" ? "image/jpeg" : "video/mp4"));
    form.append("file", await source.blob(), attachment.name || `${attachment.type}.${attachment.type === "image" ? "jpg" : "mp4"}`);
    const uploaded = await providerJson(await fetch(graphUrl(version, `${phoneNumberId}/media`), {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form
    }));
    const mediaId = asString(uploaded?.id);
    if (!mediaId) throw new Error("WhatsApp не вернул идентификатор загруженного файла.");
    const mediaPayload: Record<string, string> = { id: mediaId };
    if (caption) mediaPayload.caption = caption;
    const data = await providerJson(await fetch(graphUrl(version, `${phoneNumberId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: conversation.externalConversationId, type: attachment.type, [attachment.type]: mediaPayload })
    }));
    const message = asRecord(asArray(data?.messages)[0]);
    const externalMessageId = asString(message?.id);
    if (!externalMessageId) throw new Error("WhatsApp не вернул идентификатор медиа-сообщения.");
    return { externalMessageId, status: "sent" };
  },
  async downloadAttachment(attachment) {
    const secrets = await getMessengerSecrets("whatsapp");
    const accessToken = secrets.WHATSAPP_ACCESS_TOKEN;
    const version = secrets.WHATSAPP_GRAPH_VERSION || "v24.0";
    if (!accessToken || !attachment.externalId) throw new Error("Медиафайл WhatsApp недоступен.");
    const metadata = await providerJson(await fetch(graphUrl(version, attachment.externalId), {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store"
    }));
    const url = asString(metadata?.url);
    if (!url) throw new Error("WhatsApp не вернул ссылку на медиафайл.");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!response.ok) throw new Error("WhatsApp не отдал медиафайл.");
    return { body: await response.arrayBuffer(), mimeType: attachment.mimeType || asString(metadata?.mime_type) || response.headers.get("content-type") || "application/octet-stream", fileName: attachment.name };
  },
  normalizeWebhook(payload) {
    const normalized: NormalizedIncomingMessage[] = [];
    values(payload).forEach((value) => {
      const metadata = asRecord(value.metadata);
      const contactById = new Map(asArray(value.contacts).map((item) => {
        const contact = asRecord(item);
        const profile = asRecord(contact?.profile);
        return [asString(contact?.wa_id), asString(profile?.name)] as const;
      }));
      asArray(value.messages).forEach((item) => {
        const message = asRecord(item);
        const from = asString(message?.from);
        const externalMessageId = asString(message?.id);
        if (!message || !from || !externalMessageId) return;
        const media = attachments(message);
        normalized.push({
          channel: "whatsapp",
          connectionId: "whatsapp",
          eventId: externalMessageId,
          externalConversationId: from,
          externalContactId: from,
          externalMessageId,
          contactName: contactById.get(from) || `WhatsApp ${from}`,
          phone: from.startsWith("+") ? from : `+${from}`,
          text: messageText(message),
          sentAt: unixSecondsToIso(message.timestamp),
          contentType: media[0]?.type ?? "text",
          attachments: media,
          metadata: { phoneNumberId: asString(metadata?.phone_number_id) || null, messageType: asString(message.type) || null }
        });
      });
    });
    return normalized;
  }
};
