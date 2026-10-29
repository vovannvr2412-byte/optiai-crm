import { after, NextResponse } from "next/server";
import { processIncomingAiReply } from "@/lib/ai/messaging";
import { telegramAdapter } from "@/lib/messaging/providers/telegram";
import { archiveTelegramAttachments } from "@/lib/messaging/media-archive";
import { linkConversationToLeadSystem, listConnections, saveIncomingMessage } from "@/lib/messaging/store";
import { notifyIncomingMessage } from "@/lib/messaging/incoming";
import { getMessengerSecrets } from "@/lib/messaging/secrets";
import { processTelegramManagerCallRequest } from "@/lib/optiai/telegram-leads";
import { getCrmStateAsync } from "@/lib/crm/store";

export const maxDuration = 120;

export async function POST(request: Request) {
  const secrets = await getMessengerSecrets("telegram");
  const secret = secrets.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await request.json().catch(() => null);
  const messages = telegramAdapter.normalizeWebhook(payload);
  if (!messages.length) return NextResponse.json({ ok: true, ignored: true });
  try {
    const connection = (await listConnections()).find((item) => item.channel === "telegram");
    const botExternalAccountId = connection?.externalAccountId;
    const baseUrl = new URL(request.url).origin;
    const results = await Promise.all(messages.map(async (message) => {
      let attachments = message.attachments;
      if (secrets.TELEGRAM_BOT_TOKEN && attachments.length) {
        try {
          attachments = (await archiveTelegramAttachments(attachments, secrets.TELEGRAM_BOT_TOKEN, baseUrl)).attachments;
        } catch (error) {
          console.error("Telegram media archival failed", { message: error instanceof Error ? error.message : "Unknown error" });
        }
      }
      const eventPrefix = botExternalAccountId ?? "telegram";
      const incoming = {
        ...message,
        eventId: `${eventPrefix}:${message.eventId}`,
        externalMessageId: `${eventPrefix}:${message.externalMessageId}`,
        attachments,
        botExternalAccountId
      };
      let result = await saveIncomingMessage(incoming);
      const leadEvent = await processTelegramManagerCallRequest(incoming);
      if (leadEvent?.leadId && result.conversation) {
        const lead = (await getCrmStateAsync()).leads.find((item) => item.id === leadEvent.leadId);
        if (lead) {
          const conversation = await linkConversationToLeadSystem(result.conversation.id, lead.id, lead.ownerId);
          result = { ...result, conversation };
        }
      }
      await notifyIncomingMessage(incoming, result);
      return result;
    }));
    after(() => Promise.all(results.map(processIncomingAiReply)).then(() => undefined));
    return NextResponse.json({ ok: true, accepted: results.filter((item) => !item.duplicate).length });
  } catch {
    return NextResponse.json({ error: "Temporary processing error" }, { status: 503 });
  }
}
