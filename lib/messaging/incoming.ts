import { getCrmStateAsync } from "@/lib/crm/store";
import { createNotification } from "@/lib/notifications/store";
import { saveIncomingMessage } from "./store";
import type { NormalizedIncomingMessage } from "./types";

export async function saveIncomingMessageAndNotify(incoming: NormalizedIncomingMessage) {
  const result = await saveIncomingMessage(incoming);
  if (result.duplicate || !result.conversation) return result;
  const state = await getCrmStateAsync();
  const lead = result.conversation.leadId ? state.leads.find((item) => item.id === result.conversation?.leadId) : undefined;
  const ownerId = lead?.ownerId || result.conversation.ownerId;
  if (!ownerId) return result;
  await createNotification({
    userId: ownerId,
    leadId: lead?.id,
    type: "message",
    title: `Новое сообщение · ${result.conversation.contactName}`,
    body: incoming.text.slice(0, 240),
    eventKey: `message:${incoming.channel}:${incoming.externalMessageId}`
  });
  return result;
}
