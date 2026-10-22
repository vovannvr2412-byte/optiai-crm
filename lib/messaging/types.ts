export type MessengerChannel = "telegram" | "whatsapp" | "max";
export type MessengerConnectionStatus = "not_configured" | "needs_setup" | "connected" | "error";
export type ConversationStatus = "open" | "waiting" | "closed";
export type MessageDirection = "inbound" | "outbound";
export type MessageDeliveryStatus = "received" | "pending" | "sent" | "delivered" | "read" | "failed";
export type MessageContentType = "text" | "image" | "video" | "audio" | "file" | "location" | "unknown";

export type MessageAttachment = {
  type: Exclude<MessageContentType, "text" | "unknown">;
  externalId?: string;
  name?: string;
  mimeType?: string;
};

export type MessengerConnection = {
  id: string;
  channel: MessengerChannel;
  name: string;
  externalAccountId?: string;
  status: MessengerConnectionStatus;
  configured: boolean;
  webhookConfigured: boolean;
  lastSyncAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  requiredEnv: string[];
};

export type MessengerConversation = {
  id: string;
  connectionId: string;
  channel: MessengerChannel;
  externalConversationId: string;
  externalContactId: string;
  contactName: string;
  avatarUrl?: string;
  phone?: string;
  username?: string;
  leadId?: string;
  ownerId?: string;
  lastMessageText: string;
  lastMessageAt: string;
  unreadCount: number;
  status: ConversationStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type MessengerMessage = {
  id: string;
  conversationId: string;
  connectionId: string;
  channel: MessengerChannel;
  externalMessageId?: string;
  idempotencyKey: string;
  direction: MessageDirection;
  senderName: string;
  senderExternalId?: string;
  text: string;
  sentAt: string;
  status: MessageDeliveryStatus;
  contentType: MessageContentType;
  attachments: MessageAttachment[];
  errorReason?: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type MessagingSnapshot = {
  conversations: MessengerConversation[];
  messages: MessengerMessage[];
  processedEvents: { provider: MessengerChannel; eventId: string; receivedAt: string }[];
  connections: Omit<MessengerConnection, "configured" | "webhookConfigured" | "requiredEnv">[];
};

export type NormalizedIncomingMessage = {
  channel: MessengerChannel;
  connectionId: string;
  eventId: string;
  externalConversationId: string;
  externalContactId: string;
  externalMessageId: string;
  contactName: string;
  phone?: string;
  username?: string;
  text: string;
  sentAt: string;
  contentType: MessageContentType;
  attachments: MessageAttachment[];
  metadata?: Record<string, string | number | boolean | null>;
};

export type ProviderSendResult = {
  externalMessageId: string;
  status: Extract<MessageDeliveryStatus, "sent" | "delivered">;
};

export type ProviderHealth = {
  ok: boolean;
  externalAccountId?: string;
  message: string;
};

export type ProviderAdapter = {
  channel: MessengerChannel;
  isConfigured(): boolean;
  checkConnection(): Promise<ProviderHealth>;
  sendText(conversation: MessengerConversation, text: string): Promise<ProviderSendResult>;
  normalizeWebhook(payload: unknown): NormalizedIncomingMessage[];
};
