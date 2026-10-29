import { getCrmStateAsync } from "@/lib/crm/store";
import { createNotification } from "@/lib/notifications/store";
import { saveIncomingMessage } from "./store";
import type { NormalizedIncomingMessage } from "./types";

type IncomingSaveResult = Awaited<ReturnType<typeof saveIncomingMessage>>;

export async function saveIncomingMessageAndNotify(incoming: NormalizedIncomingMessage) {
  const result = await saveIncomingMessage(incoming);
  await notifyIncomingMessage(incoming, result);
  return result;
}

export async function notifyIncomingMessage(incoming: NormalizedIncomingMessage, result: IncomingSaveResult) {
  if (!result.conversation) return result;
  const state = await getCrmStateAsync();
  const lead = result.conversation.leadId ? state.leads.find((item) => item.id === result.conversation?.leadId) : undefined;
  const ownerId = lead?.ownerId || result.conversation.ownerId;
  const recipients = ownerId
    ? state.users.filter((user) => user.id === ownerId && user.status === "active")
    : state.users.filter((user) => user.status === "active" && user.role === "Руководитель");
  const body = incoming.text.trim().slice(0, 240)
    || (incoming.contentType === "image" ? "Получено новое фото" : incoming.contentType === "video" ? "Получено новое видео" : "Получено новое сообщение");
  await Promise.all(recipients.map((recipient) => createNotification({
    userId: recipient.id,
    leadId: lead?.id,
    type: "message",
    title: `Новое сообщение · ${result.conversation?.contactName}`,
    body,
    eventKey: `message:${incoming.channel}:${incoming.externalMessageId}:user:${recipient.id}`,
    url: "/?view=messengers"
  })));
  return result;
}
