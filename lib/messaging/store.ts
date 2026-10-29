import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { getCrmStateAsync } from "@/lib/crm/store";
import type { CrmUser, Lead } from "@/lib/crm/types";
import { connectionFromConfiguration, messengerChannels, safeProviderError } from "./config";
import { getMessengerSecretPresence } from "./secrets";
import type {
  MessageDeliveryStatus,
  MessengerChannel,
  MessengerConnection,
  MessengerConversation,
  MessengerMessage,
  MessagingSnapshot,
  NormalizedIncomingMessage,
  OutgoingMediaAttachment
} from "./types";

const dataDir = process.env.CRM_DATA_DIR || path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "messaging-state.json");
const tempPath = path.join(dataDir, "messaging-state.tmp.json");
let writeQueue: Promise<unknown> = Promise.resolve();

function supabasePersistenceEnabled() {
  return process.env.CRM_FORCE_LOCAL !== "true" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function emptySnapshot(): MessagingSnapshot {
  return { conversations: [], messages: [], processedEvents: [], connections: [] };
}

function localSnapshot() {
  if (!existsSync(filePath)) return emptySnapshot();
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<MessagingSnapshot>;
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      processedEvents: Array.isArray(parsed.processedEvents) ? parsed.processedEvents : [],
      connections: Array.isArray(parsed.connections) ? parsed.connections : []
    };
  } catch {
    return emptySnapshot();
  }
}

function persistLocal(snapshot: MessagingSnapshot) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

async function mutateLocal<T>(mutator: (snapshot: MessagingSnapshot) => T | Promise<T>): Promise<T> {
  let result!: T;
  const operation = writeQueue.then(async () => {
    const snapshot = localSnapshot();
    result = await mutator(snapshot);
    persistLocal(snapshot);
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

function record(value: unknown) {
  return value as Record<string, unknown>;
}

function toConversation(row: unknown): MessengerConversation {
  const item = record(row);
  return {
    id: String(item.id), connectionId: String(item.connection_id), channel: item.channel as MessengerChannel,
    externalConversationId: String(item.external_conversation_id), externalContactId: String(item.external_contact_id),
    botExternalAccountId: item.bot_external_account_id ? String(item.bot_external_account_id) : undefined,
    needsReconnect: Boolean(item.needs_reconnect),
    contactName: String(item.contact_name), avatarUrl: item.avatar_url ? String(item.avatar_url) : undefined,
    phone: item.phone ? String(item.phone) : undefined, username: item.username ? String(item.username) : undefined,
    leadId: item.lead_id ? String(item.lead_id) : undefined, ownerId: item.owner_id ? String(item.owner_id) : undefined,
    lastMessageText: String(item.last_message_text ?? ""), lastMessageAt: String(item.last_message_at),
    unreadCount: Number(item.unread_count ?? 0), status: item.status as MessengerConversation["status"],
    aiMode: item.ai_mode === "paused" ? "paused" : "auto",
    notes: String(item.notes ?? ""), createdAt: String(item.created_at), updatedAt: String(item.updated_at)
  };
}

function toMessage(row: unknown): MessengerMessage {
  const item = record(row);
  return {
    id: String(item.id), conversationId: String(item.conversation_id), connectionId: String(item.connection_id),
    channel: item.channel as MessengerChannel, externalMessageId: item.external_message_id ? String(item.external_message_id) : undefined,
    idempotencyKey: String(item.idempotency_key), direction: item.direction as MessengerMessage["direction"],
    senderName: String(item.sender_name), senderExternalId: item.sender_external_id ? String(item.sender_external_id) : undefined,
    text: String(item.text), sentAt: String(item.sent_at), status: item.status as MessageDeliveryStatus,
    contentType: item.content_type as MessengerMessage["contentType"], attachments: (item.attachments ?? []) as MessengerMessage["attachments"],
    errorReason: item.error_reason ? String(item.error_reason) : undefined,
    metadata: (item.metadata ?? {}) as MessengerMessage["metadata"]
  };
}

function canAccessConversation(user: CrmUser, conversation: MessengerConversation, leads: Lead[]) {
  if (user.role === "Руководитель") return true;
  const lead = conversation.leadId ? leads.find((item) => item.id === conversation.leadId) : undefined;
  if (!lead || lead.ownerId !== user.id) return false;
  return true;
}

async function accessContext(userId: string) {
  const state = await getCrmStateAsync();
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user) throw new Error("Пользователь не найден.");
  return { state, user };
}

async function allConversations() {
  if (!supabasePersistenceEnabled()) return localSnapshot().conversations.map((conversation) => ({ ...conversation, aiMode: conversation.aiMode ?? "auto" }));
  const { data, error } = await createServiceSupabaseClient().from("messenger_conversations").select("*").order("last_message_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toConversation);
}

export async function listConversationsForUser(userId: string, search = "") {
  const [{ state, user }, conversations] = await Promise.all([accessContext(userId), allConversations()]);
  const accessible = conversations.filter((conversation) => canAccessConversation(user, conversation, state.leads));
  const needle = search.trim().toLowerCase();
  if (!needle) return accessible.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));

  let messageConversationIds = new Set<string>();
  if (!supabasePersistenceEnabled()) {
    messageConversationIds = new Set(localSnapshot().messages.filter((message) => message.text.toLowerCase().includes(needle)).map((message) => message.conversationId));
  } else {
    const escaped = needle.replace(/[%,_]/g, (value) => `\\${value}`);
    const { data, error } = await createServiceSupabaseClient().from("messenger_messages").select("conversation_id").ilike("text", `%${escaped}%`).limit(500);
    if (error) throw error;
    messageConversationIds = new Set((data ?? []).map((row) => String(row.conversation_id)));
  }
  return accessible.filter((conversation) => {
    const contact = [conversation.contactName, conversation.phone, conversation.username, conversation.lastMessageText].filter(Boolean).join(" ").toLowerCase();
    return contact.includes(needle) || messageConversationIds.has(conversation.id);
  }).sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}

export async function getConversationForUser(userId: string, conversationId: string) {
  const conversations = await listConversationsForUser(userId);
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error("Диалог не найден или недоступен.");
  return conversation;
}

export async function getConversationSystem(conversationId: string) {
  if (!supabasePersistenceEnabled()) {
    const conversation = localSnapshot().conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("Диалог не найден.");
    return structuredClone({ ...conversation, aiMode: conversation.aiMode ?? "auto" });
  }
  const { data, error } = await createServiceSupabaseClient().from("messenger_conversations").select("*").eq("id", conversationId).single();
  if (error) throw error;
  return toConversation(data);
}

export async function listConversationMessagesSystem(conversationId: string, limit = 20) {
  const safeLimit = Math.min(40, Math.max(1, limit));
  if (!supabasePersistenceEnabled()) {
    return localSnapshot().messages
      .filter((item) => item.conversationId === conversationId)
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
      .slice(0, safeLimit)
      .reverse();
  }
  const { data, error } = await createServiceSupabaseClient().from("messenger_messages").select("*")
    .eq("conversation_id", conversationId).order("sent_at", { ascending: false }).limit(safeLimit);
  if (error) throw error;
  return (data ?? []).map(toMessage).reverse();
}

export async function getMessageForUser(userId: string, messageId: string) {
  let message: MessengerMessage | undefined;
  if (!supabasePersistenceEnabled()) {
    message = localSnapshot().messages.find((item) => item.id === messageId);
  } else {
    const { data, error } = await createServiceSupabaseClient().from("messenger_messages").select("*").eq("id", messageId).maybeSingle();
    if (error) throw error;
    if (data) message = toMessage(data);
  }
  if (!message) throw new Error("Сообщение не найдено.");
  await getConversationForUser(userId, message.conversationId);
  return message;
}

export async function listUnarchivedTelegramMedia() {
  if (!supabasePersistenceEnabled()) {
    return localSnapshot().messages
      .filter((message) => message.channel === "telegram" && message.direction === "inbound"
        && message.attachments.some((attachment) => (attachment.type === "image" || attachment.type === "video") && attachment.externalId && !attachment.url))
      .map((message) => ({ id: message.id, attachments: structuredClone(message.attachments) }));
  }

  const supabase = createServiceSupabaseClient();
  const result: { id: string; attachments: MessengerMessage["attachments"] }[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("messenger_messages")
      .select("id,attachments")
      .eq("channel", "telegram")
      .eq("direction", "inbound")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const attachments = (row.attachments ?? []) as MessengerMessage["attachments"];
      if (attachments.some((attachment) => (attachment.type === "image" || attachment.type === "video") && attachment.externalId && !attachment.url)) {
        result.push({ id: String(row.id), attachments });
      }
    }
    if (!data || data.length < pageSize) break;
  }
  return result;
}

export async function saveMessageAttachments(messageId: string, attachments: MessengerMessage["attachments"]) {
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const message = snapshot.messages.find((item) => item.id === messageId);
      if (!message) throw new Error("Сообщение для архивации медиа не найдено.");
      message.attachments = structuredClone(attachments);
    });
  }
  const { error } = await createServiceSupabaseClient().from("messenger_messages").update({ attachments }).eq("id", messageId);
  if (error) throw error;
}

export async function listMessagesForUser(userId: string, conversationId: string, before?: string, limit = 40) {
  await getConversationForUser(userId, conversationId);
  const safeLimit = Math.min(100, Math.max(1, limit));
  if (!supabasePersistenceEnabled()) {
    const messages = localSnapshot().messages
      .filter((item) => item.conversationId === conversationId && (!before || item.sentAt < before))
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
    return { messages: messages.slice(0, safeLimit).reverse(), hasMore: messages.length > safeLimit };
  }
  let query = createServiceSupabaseClient().from("messenger_messages").select("*").eq("conversation_id", conversationId).order("sent_at", { ascending: false }).limit(safeLimit + 1);
  if (before) query = query.lt("sent_at", before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  return { messages: rows.slice(0, safeLimit).map(toMessage).reverse(), hasMore: rows.length > safeLimit };
}

export async function markConversationRead(userId: string, conversationId: string) {
  await getConversationForUser(userId, conversationId);
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const conversation = snapshot.conversations.find((item) => item.id === conversationId);
      if (conversation) { conversation.unreadCount = 0; conversation.updatedAt = new Date().toISOString(); }
    });
  }
  const { error } = await createServiceSupabaseClient().from("messenger_conversations").update({ unread_count: 0, updated_at: new Date().toISOString() }).eq("id", conversationId);
  if (error) throw error;
}

export async function updateConversationForUser(userId: string, conversationId: string, changes: { leadId?: string | null; ownerId?: string | null; notes?: string; status?: MessengerConversation["status"]; aiMode?: MessengerConversation["aiMode"] }) {
  const [{ state, user }, conversation] = await Promise.all([accessContext(userId), getConversationForUser(userId, conversationId)]);
  if ((changes.leadId !== undefined || changes.ownerId !== undefined) && user.role !== "Руководитель") throw new Error("Связь с лидом может изменить только руководитель.");
  if (changes.leadId && !state.leads.some((item) => item.id === changes.leadId)) throw new Error("Выбранный лид не найден.");
  if (changes.ownerId && !state.users.some((item) => item.id === changes.ownerId && item.status === "active")) throw new Error("Выбранный сотрудник недоступен.");
  const updatedAt = new Date().toISOString();
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const item = snapshot.conversations.find((entry) => entry.id === conversation.id);
      if (!item) throw new Error("Диалог не найден.");
      if (changes.leadId !== undefined) item.leadId = changes.leadId ?? undefined;
      if (changes.ownerId !== undefined) item.ownerId = changes.ownerId ?? undefined;
      if (changes.notes !== undefined) item.notes = changes.notes.slice(0, 2000);
      if (changes.status !== undefined) item.status = changes.status;
      if (changes.aiMode !== undefined) item.aiMode = changes.aiMode;
      item.updatedAt = updatedAt;
      return structuredClone(item);
    });
  }
  const payload: Record<string, unknown> = { updated_at: updatedAt };
  if (changes.leadId !== undefined) payload.lead_id = changes.leadId;
  if (changes.ownerId !== undefined) payload.owner_id = changes.ownerId;
  if (changes.notes !== undefined) payload.notes = changes.notes.slice(0, 2000);
  if (changes.status !== undefined) payload.status = changes.status;
  if (changes.aiMode !== undefined) payload.ai_mode = changes.aiMode;
  const { data, error } = await createServiceSupabaseClient().from("messenger_conversations").update(payload).eq("id", conversationId).select("*").single();
  if (error) throw error;
  return toConversation(data);
}

export async function linkConversationToLeadSystem(conversationId: string, leadId: string, ownerId: string) {
  const updatedAt = new Date().toISOString();
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const conversation = snapshot.conversations.find((item) => item.id === conversationId);
      if (!conversation) throw new Error("Диалог не найден.");
      conversation.leadId = leadId;
      conversation.ownerId = ownerId;
      conversation.updatedAt = updatedAt;
      return structuredClone(conversation);
    });
  }
  const { data, error } = await createServiceSupabaseClient().from("messenger_conversations").update({
    lead_id: leadId,
    owner_id: ownerId,
    updated_at: updatedAt
  }).eq("id", conversationId).select("*").single();
  if (error) throw error;
  return toConversation(data);
}

export async function updateConversationAiModeSystem(conversationId: string, aiMode: MessengerConversation["aiMode"], status?: MessengerConversation["status"]) {
  const updatedAt = new Date().toISOString();
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const conversation = snapshot.conversations.find((item) => item.id === conversationId);
      if (!conversation) throw new Error("Диалог не найден.");
      conversation.aiMode = aiMode;
      if (status) conversation.status = status;
      conversation.updatedAt = updatedAt;
      return structuredClone(conversation);
    });
  }
  const payload: Record<string, unknown> = { ai_mode: aiMode, updated_at: updatedAt };
  if (status) payload.status = status;
  const { data, error } = await createServiceSupabaseClient().from("messenger_conversations").update(payload).eq("id", conversationId).select("*").single();
  if (error) throw error;
  return toConversation(data);
}

export async function createPendingMessage(userId: string, conversationId: string, text: string, idempotencyKey: string, attachment?: OutgoingMediaAttachment) {
  const [conversation, { user }] = await Promise.all([getConversationForUser(userId, conversationId), accessContext(userId)]);
  const now = new Date().toISOString();
  const message: MessengerMessage = {
    id: randomUUID(), conversationId, connectionId: conversation.connectionId, channel: conversation.channel,
    idempotencyKey, direction: "outbound", senderName: user.fullName, senderExternalId: user.id,
    text: text.trim(), sentAt: now, status: "pending", contentType: attachment?.type ?? "text", attachments: attachment ? [attachment] : [], metadata: {}
  };
  if (!message.text && !attachment) throw new Error("Введите текст или прикрепите файл.");
  if (message.text.length > 4000) throw new Error("Сообщение не должно превышать 4000 символов.");

  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const existing = snapshot.messages.find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) return structuredClone(existing);
      snapshot.messages.push(message);
      const item = snapshot.conversations.find((entry) => entry.id === conversationId);
      if (item) { item.lastMessageText = message.text || (attachment?.type === "image" ? "Фото" : "Видео"); item.lastMessageAt = now; item.updatedAt = now; }
      return structuredClone(message);
    });
  }
  const { data, error } = await createServiceSupabaseClient().from("messenger_messages").upsert({
    id: message.id, conversation_id: message.conversationId, connection_id: message.connectionId, channel: message.channel,
    idempotency_key: message.idempotencyKey, direction: message.direction, sender_name: message.senderName,
    sender_external_id: message.senderExternalId, text: message.text, sent_at: message.sentAt, status: message.status,
    content_type: message.contentType, attachments: message.attachments, metadata: message.metadata
  }, { onConflict: "idempotency_key", ignoreDuplicates: false }).select("*").single();
  if (error) throw error;
  const { error: conversationError } = await createServiceSupabaseClient().from("messenger_conversations").update({ last_message_text: message.text || (attachment?.type === "image" ? "Фото" : "Видео"), last_message_at: now, updated_at: now }).eq("id", conversationId);
  if (conversationError) throw conversationError;
  return toMessage(data);
}

export async function createPendingMessageOnce(userId: string, conversationId: string, text: string, idempotencyKey: string, attachment?: OutgoingMediaAttachment) {
  const [conversation, { user }] = await Promise.all([getConversationForUser(userId, conversationId), accessContext(userId)]);
  const now = new Date().toISOString();
  const message: MessengerMessage = {
    id: randomUUID(), conversationId, connectionId: conversation.connectionId, channel: conversation.channel,
    idempotencyKey, direction: "outbound", senderName: user.fullName, senderExternalId: user.id,
    text: text.trim(), sentAt: now, status: "pending", contentType: attachment?.type ?? "text", attachments: attachment ? [attachment] : [], metadata: { automated: true }
  };
  if (!message.text && !attachment) throw new Error("Автоматическое сообщение не содержит текста или вложения.");
  if (message.text.length > 4000) throw new Error("Автоматическое сообщение превышает 4000 символов.");

  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const existing = snapshot.messages.find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) return { message: structuredClone(existing), created: false };
      snapshot.messages.push(message);
      const item = snapshot.conversations.find((entry) => entry.id === conversationId);
      if (item) { item.lastMessageText = message.text || (attachment?.type === "image" ? "Фото" : "Видео"); item.lastMessageAt = now; item.updatedAt = now; }
      return { message: structuredClone(message), created: true };
    });
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("messenger_messages").insert({
    id: message.id, conversation_id: message.conversationId, connection_id: message.connectionId, channel: message.channel,
    idempotency_key: message.idempotencyKey, direction: message.direction, sender_name: message.senderName,
    sender_external_id: message.senderExternalId, text: message.text, sent_at: message.sentAt, status: message.status,
    content_type: message.contentType, attachments: message.attachments, metadata: message.metadata
  }).select("*").single();
  if (error) {
    if (error.code !== "23505") throw error;
    const { data: existing, error: existingError } = await supabase
      .from("messenger_messages")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .single();
    if (existingError) throw existingError;
    return { message: toMessage(existing), created: false };
  }
  const { error: conversationError } = await supabase.from("messenger_conversations").update({
    last_message_text: message.text || (attachment?.type === "image" ? "Фото" : "Видео"),
    last_message_at: now,
    updated_at: now
  }).eq("id", conversationId);
  if (conversationError) throw conversationError;
  return { message: toMessage(data), created: true };
}

export async function createAiPendingMessageOnce(conversation: MessengerConversation, text: string, idempotencyKey: string, triggerMessageId: string) {
  const now = new Date().toISOString();
  const message: MessengerMessage = {
    id: randomUUID(), conversationId: conversation.id, connectionId: conversation.connectionId, channel: conversation.channel,
    idempotencyKey, direction: "outbound", senderName: "AI OptiAI", text: text.trim(), sentAt: now,
    status: "pending", contentType: "text", attachments: [], metadata: { automated: true, ai: true, triggerMessageId }
  };
  if (!message.text) throw new Error("AI не подготовил текст ответа.");
  if (message.text.length > 3500) throw new Error("AI-ответ превышает допустимую длину.");

  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const existing = snapshot.messages.find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) return { message: structuredClone(existing), created: false };
      snapshot.messages.push(message);
      const item = snapshot.conversations.find((entry) => entry.id === conversation.id);
      if (item) { item.lastMessageText = message.text; item.lastMessageAt = now; item.updatedAt = now; }
      return { message: structuredClone(message), created: true };
    });
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("messenger_messages").insert({
    id: message.id, conversation_id: message.conversationId, connection_id: message.connectionId, channel: message.channel,
    idempotency_key: message.idempotencyKey, direction: message.direction, sender_name: message.senderName,
    text: message.text, sent_at: message.sentAt, status: message.status, content_type: message.contentType,
    attachments: message.attachments, metadata: message.metadata
  }).select("*").single();
  if (error) {
    if (error.code !== "23505") throw error;
    const { data: existing, error: existingError } = await supabase.from("messenger_messages").select("*").eq("idempotency_key", idempotencyKey).single();
    if (existingError) throw existingError;
    return { message: toMessage(existing), created: false };
  }
  const { error: conversationError } = await supabase.from("messenger_conversations").update({
    last_message_text: message.text, last_message_at: now, updated_at: now
  }).eq("id", conversation.id);
  if (conversationError) throw conversationError;
  return { message: toMessage(data), created: true };
}

export async function finishOutgoingMessage(messageId: string, result: { status: MessageDeliveryStatus; externalMessageId?: string; errorReason?: string }) {
  const errorReason = result.errorReason ? safeProviderError(result.errorReason) : undefined;
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const message = snapshot.messages.find((item) => item.id === messageId);
      if (!message) throw new Error("Исходящее сообщение не найдено.");
      message.status = result.status;
      message.externalMessageId = result.externalMessageId;
      message.errorReason = errorReason;
      return structuredClone(message);
    });
  }
  const { data, error } = await createServiceSupabaseClient().from("messenger_messages").update({
    status: result.status, external_message_id: result.externalMessageId ?? null, error_reason: errorReason ?? null
  }).eq("id", messageId).select("*").single();
  if (error) throw error;
  return toMessage(data);
}

export async function saveIncomingMessage(incoming: NormalizedIncomingMessage) {
  const now = new Date().toISOString();
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const duplicateMessage = snapshot.messages.find((message) => message.channel === incoming.channel && message.connectionId === incoming.connectionId && message.externalMessageId === incoming.externalMessageId);
      if (snapshot.processedEvents.some((event) => event.provider === incoming.channel && event.eventId === incoming.eventId) || duplicateMessage) {
        const conversation = duplicateMessage ? snapshot.conversations.find((item) => item.id === duplicateMessage.conversationId) : undefined;
        return {
          duplicate: true,
          conversation: conversation ? structuredClone(conversation) : undefined,
          message: duplicateMessage ? structuredClone(duplicateMessage) : undefined
        };
      }
      let conversation = snapshot.conversations.find((item) => item.connectionId === incoming.connectionId && item.externalConversationId === incoming.externalConversationId);
      if (!conversation) {
        conversation = {
          id: randomUUID(), connectionId: incoming.connectionId, channel: incoming.channel,
          externalConversationId: incoming.externalConversationId, externalContactId: incoming.externalContactId,
          botExternalAccountId: incoming.botExternalAccountId, needsReconnect: false,
          contactName: incoming.contactName, phone: incoming.phone, username: incoming.username,
          lastMessageText: incoming.text, lastMessageAt: incoming.sentAt, unreadCount: 0,
          status: "open", aiMode: "auto", notes: "", createdAt: now, updatedAt: now
        };
        snapshot.conversations.push(conversation);
      }
      conversation.contactName = incoming.contactName || conversation.contactName;
      conversation.phone = incoming.phone || conversation.phone;
      conversation.username = incoming.username || conversation.username;
      if (incoming.channel === "telegram" && incoming.botExternalAccountId) {
        conversation.botExternalAccountId = incoming.botExternalAccountId;
        conversation.needsReconnect = false;
      }
      conversation.lastMessageText = incoming.text;
      conversation.lastMessageAt = incoming.sentAt;
      conversation.unreadCount += 1;
      conversation.status = "open";
      conversation.updatedAt = now;
      const message: MessengerMessage = {
        id: randomUUID(), conversationId: conversation.id, connectionId: incoming.connectionId, channel: incoming.channel,
        externalMessageId: incoming.externalMessageId, idempotencyKey: `${incoming.channel}:${incoming.connectionId}:${incoming.externalMessageId}`,
        direction: "inbound", senderName: incoming.contactName, senderExternalId: incoming.externalContactId,
        text: incoming.text, sentAt: incoming.sentAt, status: "received", contentType: incoming.contentType,
        attachments: incoming.attachments, metadata: incoming.metadata ?? {}
      };
      snapshot.messages.push(message);
      snapshot.processedEvents.push({ provider: incoming.channel, eventId: incoming.eventId, receivedAt: now });
      return { duplicate: false, conversation: structuredClone(conversation), message: structuredClone(message) };
    });
  }

  const supabase = createServiceSupabaseClient();
  const { data: existingMessage, error: existingMessageError } = await supabase.from("messenger_messages").select("*").eq("connection_id", incoming.connectionId).eq("channel", incoming.channel).eq("external_message_id", incoming.externalMessageId).maybeSingle();
  if (existingMessageError) throw existingMessageError;
  if (existingMessage) {
    const message = toMessage(existingMessage);
    const { data: duplicateConversation, error: duplicateConversationError } = await supabase.from("messenger_conversations").select("*").eq("id", message.conversationId).single();
    if (duplicateConversationError) throw duplicateConversationError;
    return { duplicate: true, conversation: toConversation(duplicateConversation), message };
  }
  const { data: existingConversation, error: findError } = await supabase.from("messenger_conversations").select("*").eq("connection_id", incoming.connectionId).eq("external_conversation_id", incoming.externalConversationId).maybeSingle();
  if (findError) throw findError;
  let conversation = existingConversation ? toConversation(existingConversation) : null;
  if (!conversation) {
    const { data, error } = await supabase.from("messenger_conversations").insert({
      connection_id: incoming.connectionId, channel: incoming.channel, external_conversation_id: incoming.externalConversationId,
      external_contact_id: incoming.externalContactId, contact_name: incoming.contactName, phone: incoming.phone,
      bot_external_account_id: incoming.botExternalAccountId ?? null, needs_reconnect: false,
      username: incoming.username, last_message_text: incoming.text, last_message_at: incoming.sentAt,
      unread_count: 1, status: "open", ai_mode: "auto", notes: ""
    }).select("*").single();
    if (error) throw error;
    conversation = toConversation(data);
  }
  const messageId = randomUUID();
  const { data: saved, error: messageError } = await supabase.from("messenger_messages").insert({
    id: messageId, conversation_id: conversation.id, connection_id: incoming.connectionId, channel: incoming.channel,
    external_message_id: incoming.externalMessageId, idempotency_key: `${incoming.channel}:${incoming.connectionId}:${incoming.externalMessageId}`,
    direction: "inbound", sender_name: incoming.contactName, sender_external_id: incoming.externalContactId,
    text: incoming.text, sent_at: incoming.sentAt, status: "received", content_type: incoming.contentType,
    attachments: incoming.attachments, metadata: incoming.metadata ?? {}
  }).select("*").single();
  if (messageError) {
    if (messageError.code === "23505") return { duplicate: true, conversation: undefined, message: undefined };
    throw messageError;
  }
  const { data: updatedConversation, error: updateError } = await supabase.from("messenger_conversations").update({
    contact_name: incoming.contactName, phone: incoming.phone ?? conversation.phone, username: incoming.username ?? conversation.username,
    ...(incoming.channel === "telegram" && incoming.botExternalAccountId ? { bot_external_account_id: incoming.botExternalAccountId, needs_reconnect: false } : {}),
    last_message_text: incoming.text, last_message_at: incoming.sentAt, unread_count: conversation.unreadCount + 1,
    status: "open", updated_at: now
  }).eq("id", conversation.id).select("*").single();
  if (updateError) throw updateError;
  await supabase.from("messenger_webhook_events").upsert({ provider: incoming.channel, event_id: incoming.eventId, received_at: now }, { onConflict: "provider,event_id", ignoreDuplicates: true });
  return { duplicate: false, conversation: toConversation(updatedConversation), message: toMessage(saved) };
}

export async function updateMessageStatusByExternalId(channel: MessengerChannel, externalMessageId: string, status: MessageDeliveryStatus, errorReason?: string) {
  if (!supabasePersistenceEnabled()) {
    return mutateLocal((snapshot) => {
      const message = snapshot.messages.find((item) => item.channel === channel && item.externalMessageId === externalMessageId);
      if (message) { message.status = status; message.errorReason = errorReason ? safeProviderError(errorReason) : undefined; }
      return Boolean(message);
    });
  }
  const { error } = await createServiceSupabaseClient().from("messenger_messages").update({ status, error_reason: errorReason ? safeProviderError(errorReason) : null }).eq("channel", channel).eq("external_message_id", externalMessageId);
  if (error) throw error;
  return true;
}

export async function listConnections(): Promise<MessengerConnection[]> {
  let saved: MessagingSnapshot["connections"] = [];
  if (!supabasePersistenceEnabled()) saved = localSnapshot().connections;
  else {
    const { data, error } = await createServiceSupabaseClient().from("messenger_connections").select("*");
    if (error) throw error;
    saved = (data ?? []).map((row) => {
      const item = record(row);
      return {
        id: String(item.id), channel: item.channel as MessengerChannel, name: String(item.name), status: item.status as MessengerConnection["status"],
        externalAccountId: item.external_account_id ? String(item.external_account_id) : undefined,
        externalAccountUsername: item.external_account_username ? String(item.external_account_username) : undefined,
        lastSyncAt: item.last_sync_at ? String(item.last_sync_at) : undefined, lastErrorAt: item.last_error_at ? String(item.last_error_at) : undefined,
        lastError: item.last_error ? String(item.last_error) : undefined
      };
    });
  }
  const presence = await Promise.all(messengerChannels.map(async (channel) => {
    try {
      return await getMessengerSecretPresence(channel);
    } catch {
      return {};
    }
  }));
  return messengerChannels.map((channel, index) => connectionFromConfiguration(channel, saved.find((item) => item.channel === channel), presence[index]));
}

export async function assertTelegramReplacementSchema() {
  if (!supabasePersistenceEnabled()) return;
  const supabase = createServiceSupabaseClient();
  const [{ error: connectionError }, { error: conversationError }] = await Promise.all([
    supabase.from("messenger_connections").select("external_account_username").limit(1),
    supabase.from("messenger_conversations").select("bot_external_account_id,needs_reconnect").limit(1)
  ]);
  if (connectionError || conversationError) {
    throw new Error("База данных не готова к замене бота. Выполните миграцию 0007_telegram_bot_replacement.sql в Supabase.");
  }
}

export async function saveConnectionCheck(channel: MessengerChannel, result: { ok: boolean; externalAccountId?: string; externalAccountUsername?: string; message: string }) {
  const now = new Date().toISOString();
  const configuredFields = await getMessengerSecretPresence(channel);
  const base = connectionFromConfiguration(channel, undefined, configuredFields);
  const connection = connectionFromConfiguration(channel, {
    id: channel, channel, name: base.name,
    status: result.ok ? "connected" : "error", externalAccountId: result.externalAccountId,
    externalAccountUsername: result.externalAccountUsername,
    lastSyncAt: result.ok ? now : undefined, lastErrorAt: result.ok ? undefined : now,
    lastError: result.ok ? undefined : safeProviderError(result.message)
  }, configuredFields);
  if (!supabasePersistenceEnabled()) {
    await mutateLocal((snapshot) => {
      const stored = {
        id: connection.id, channel: connection.channel, name: connection.name, status: connection.status,
        externalAccountId: connection.externalAccountId, externalAccountUsername: connection.externalAccountUsername,
        lastSyncAt: connection.lastSyncAt,
        lastErrorAt: connection.lastErrorAt, lastError: connection.lastError
      };
      const index = snapshot.connections.findIndex((item) => item.channel === channel);
      if (index >= 0) snapshot.connections[index] = stored;
      else snapshot.connections.push(stored);
    });
    return connection;
  }
  const { error } = await createServiceSupabaseClient().from("messenger_connections").upsert({
    id: channel, channel, name: connection.name, external_account_id: connection.externalAccountId ?? null,
    external_account_username: connection.externalAccountUsername ?? null,
    status: connection.status, last_sync_at: connection.lastSyncAt ?? null,
    last_error_at: connection.lastErrorAt ?? null, last_error: connection.lastError ?? null, updated_at: now
  }, { onConflict: "id" });
  if (error) throw error;
  return connection;
}

export async function activateTelegramBot(input: {
  externalAccountId: string;
  externalAccountUsername?: string;
  previousExternalAccountId?: string;
  forceReconnect?: boolean;
}) {
  const switchedBot = Boolean(input.forceReconnect || (input.previousExternalAccountId && input.previousExternalAccountId !== input.externalAccountId));
  const connection = await saveConnectionCheck("telegram", {
    ok: true,
    externalAccountId: input.externalAccountId,
    externalAccountUsername: input.externalAccountUsername,
    message: "Telegram-бот подключён."
  });
  const updatedAt = new Date().toISOString();
  let conversationsUpdated = 0;
  let conversationsAwaitingStart = 0;
  if (!supabasePersistenceEnabled()) {
    await mutateLocal((snapshot) => {
      snapshot.conversations.forEach((conversation) => {
        if (conversation.channel !== "telegram") return;
        conversation.botExternalAccountId = input.externalAccountId;
        if (switchedBot) conversation.needsReconnect = true;
        conversation.updatedAt = updatedAt;
        conversationsUpdated += 1;
        if (conversation.needsReconnect) conversationsAwaitingStart += 1;
      });
    });
  } else {
    const update: Record<string, unknown> = {
      bot_external_account_id: input.externalAccountId,
      updated_at: updatedAt
    };
    if (switchedBot) update.needs_reconnect = true;
    const { count, error } = await createServiceSupabaseClient()
      .from("messenger_conversations")
      .update(update, { count: "exact" })
      .eq("channel", "telegram");
    if (error) throw error;
    conversationsUpdated = count ?? 0;
    const { count: reconnectCount, error: reconnectError } = await createServiceSupabaseClient()
      .from("messenger_conversations")
      .select("id", { count: "exact", head: true })
      .eq("channel", "telegram")
      .eq("needs_reconnect", true);
    if (reconnectError) throw reconnectError;
    conversationsAwaitingStart = reconnectCount ?? 0;
  }
  return {
    connection,
    switchedBot,
    conversationsUpdated,
    conversationsAwaitingStart
  };
}

export async function resetConnectionStatus(channel: MessengerChannel) {
  const now = new Date().toISOString();
  if (!supabasePersistenceEnabled()) {
    await mutateLocal((snapshot) => {
      const connection = snapshot.connections.find((item) => item.channel === channel);
      if (connection) { connection.status = "needs_setup"; connection.lastError = undefined; connection.lastErrorAt = undefined; }
    });
    return;
  }
  const { error } = await createServiceSupabaseClient().from("messenger_connections").update({ status: "needs_setup", last_error: null, last_error_at: null, updated_at: now }).eq("channel", channel);
  if (error) throw error;
}
