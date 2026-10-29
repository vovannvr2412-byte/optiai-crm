import type { NormalizedIncomingMessage } from "@/lib/messaging/types";
import { processOptiaiEvent } from "./events";
import { isTelegramManagerCallRequest } from "./telegram-intent";

export async function processTelegramManagerCallRequest(message: NormalizedIncomingMessage) {
  if (!isTelegramManagerCallRequest(message)) return null;
  return processOptiaiEvent({
    eventId: `telegram-manager-call:${message.eventId}`,
    type: "manager_call_requested",
    occurredAt: message.sentAt,
    data: {
      telegram_id: message.externalContactId,
      telegram_username: message.username ?? "",
      contact_name: message.contactName,
      phone: message.phone ?? ""
    }
  });
}
