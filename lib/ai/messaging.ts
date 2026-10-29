import { generateConversationReply } from "@/lib/ai/service";
import { getCrmStateAsync, supabasePersistenceEnabled } from "@/lib/crm/store";
import { safeProviderError } from "@/lib/messaging/config";
import { providerFor } from "@/lib/messaging/providers";
import {
  createAiPendingMessageOnce,
  finishOutgoingMessage,
  getConversationSystem,
  listConversationMessagesSystem,
  updateConversationAiModeSystem
} from "@/lib/messaging/store";
import type { MessengerConversation, MessengerMessage } from "@/lib/messaging/types";
import { createNotification } from "@/lib/notifications/store";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const supportedChannels = new Set(["telegram", "whatsapp", "max"]);

async function notificationRecipients(conversation: MessengerConversation) {
  const state = await getCrmStateAsync();
  const lead = conversation.leadId ? state.leads.find((item) => item.id === conversation.leadId) : undefined;
  const ownerId = lead?.ownerId || conversation.ownerId;
  const recipients = ownerId
    ? state.users.filter((user) => user.id === ownerId && user.status === "active")
    : state.users.filter((user) => user.status === "active" && user.role === "Руководитель");
  return { state, lead, recipients };
}

async function notifyHandoff(conversation: MessengerConversation, trigger: MessengerMessage, reason: string) {
  const { lead, recipients } = await notificationRecipients(conversation);
  await Promise.all(recipients.map((recipient) => createNotification({
    userId: recipient.id,
    leadId: lead?.id,
    type: "message",
    title: `AI передал диалог менеджеру · ${conversation.contactName}`,
    body: reason || "Диалогу нужен ответ сотрудника.",
    eventKey: `ai-handoff:${trigger.id}:user:${recipient.id}`,
    url: "/?view=messengers"
  })));
}

async function saveAiActivity(conversation: MessengerConversation, text: string) {
  if (!supabasePersistenceEnabled() || !conversation.leadId) return;
  const now = new Date().toISOString();
  const supabase = createServiceSupabaseClient();
  const [{ error: leadError }, { error: activityError }] = await Promise.all([
    supabase.from("leads").update({ last_contact_at: now }).eq("id", conversation.leadId),
    supabase.from("activities").insert({
      lead_id: conversation.leadId,
      type: "message",
      title: `AI-ответ · ${conversation.channel}`,
      detail: text,
      created_at: now
    })
  ]);
  if (leadError) throw leadError;
  if (activityError) throw activityError;
}

export async function processIncomingAiReply(input: {
  duplicate: boolean;
  conversation?: MessengerConversation;
  message?: MessengerMessage;
}) {
  if (input.duplicate || !input.conversation || !input.message || !supportedChannels.has(input.conversation.channel)) return;
  let conversation = input.conversation;
  try {
    conversation = await getConversationSystem(input.conversation.id);
    if (conversation.aiMode !== "auto" || conversation.status === "closed") return;
    if (conversation.channel === "telegram" && conversation.needsReconnect) return;

    const history = await listConversationMessagesSystem(conversation.id, 20);
    if (history.at(-1)?.id !== input.message.id) return;
    const state = await getCrmStateAsync();
    const lead = conversation.leadId ? state.leads.find((item) => item.id === conversation.leadId) : undefined;
    const decision = await generateConversationReply({ conversation, messages: history, lead });
    if (!decision || decision.action === "ignore") return;
    if (decision.action === "handoff") {
      await updateConversationAiModeSystem(conversation.id, "paused", "waiting");
      await notifyHandoff(conversation, input.message, decision.reason);
      return;
    }

    conversation = await getConversationSystem(conversation.id);
    const freshHistory = await listConversationMessagesSystem(conversation.id, 3);
    if (conversation.aiMode !== "auto" || freshHistory.at(-1)?.id !== input.message.id) return;
    const adapter = providerFor(conversation.channel);
    if (!await adapter.isConfigured()) throw new Error(`${conversation.channel}: подключение не настроено.`);

    const pending = await createAiPendingMessageOnce(conversation, decision.message, `ai-reply:${input.message.id}`, input.message.id);
    if (["sent", "delivered", "read"].includes(pending.message.status)) return;
    try {
      const sent = await adapter.sendText(conversation, pending.message.text);
      await finishOutgoingMessage(pending.message.id, sent);
      await saveAiActivity(conversation, pending.message.text);
    } catch (error) {
      await finishOutgoingMessage(pending.message.id, { status: "failed", errorReason: safeProviderError(error) });
      throw error;
    }
  } catch (error) {
    const reason = safeProviderError(error);
    console.error("AI messenger reply failed", { conversationId: conversation.id, messageId: input.message.id, reason });
    await notifyHandoff(conversation, input.message, `Автоматический ответ не отправлен: ${reason}`).catch(() => undefined);
  }
}
