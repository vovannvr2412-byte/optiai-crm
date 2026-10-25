import { getCrmStateAsync } from "@/lib/crm/store";
import { createNotification } from "@/lib/notifications/store";
import { saveIncomingMessage } from "./store";
import type { NormalizedIncomingMessage } from "./types";

export async function saveIncomingMessageAndNotify(incoming: NormalizedIncomingMessage) {
  const result = await saveIncomingMessage(incoming);
  if (!result.conversation) return result;
  const state = await getCrmStateAsync();
  const lead = result.conversation.leadId ? state.leads.find((item) => item.id === result.conversation?.leadId) : undefined;
  const ownerId = lead?.ownerId || result.conversation.ownerId;
  const recipients = ownerId
    ? state.users.filter((user) => user.id === ownerId && user.status === "active")
    : state.users.filter((user) => user.status === "active" && (user.role === "Руководитель" || user.role === "РОП"));
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
