export type MessengerChannel = "telegram" | "whatsapp" | "max" | "instagram" | "avito";
export type MessengerConnectionStatus = "not_configured" | "needs_setup" | "connected" | "error";
export type ConversationStatus = "open" | "waiting" | "closed";
export type MessageDirection = "inbound" | "outbound";
export type MessageDeliveryStatus = "received" | "pending" | "sent" | "delivered" | "read" | "failed";
export type MessageContentType = "text" | "image" | "video" | "audio" | "file" | "location" | "unknown";

export type MessageAttachment = {
  type: Exclude<MessageContentType, "text" | "unknown">;
  externalId?: string;
  url?: string;
  name?: string;
  mimeType?: string;
};

export type OutgoingMediaAttachment = MessageAttachment & {
  type: "image" | "video";
  url: string;
};

export type ProviderMediaDownload = {
  body: ArrayBuffer;
  mimeType: string;
  fileName?: string;
};

export type MessengerConnection = {
  id: string;
  channel: MessengerChannel;
  name: string;
  externalAccountId?: string;
  externalAccountUsername?: string;
  status: MessengerConnectionStatus;
  configured: boolean;
  webhookConfigured: boolean;
  configuredFields: Record<string, boolean>;
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
  botExternalAccountId?: string;
  needsReconnect: boolean;
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
  connections: Omit<MessengerConnection, "configured" | "webhookConfigured" | "configuredFields" | "requiredEnv">[];
};

export type NormalizedIncomingMessage = {
  channel: MessengerChannel;
  connectionId: string;
  eventId: string;
  externalConversationId: string;
  externalContactId: string;
  botExternalAccountId?: string;
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
  externalAccountUsername?: string;
  message: string;
};

export type ProviderAdapter = {
  channel: MessengerChannel;
  isConfigured(): Promise<boolean>;
  checkConnection(): Promise<ProviderHealth>;
  sendText(conversation: MessengerConversation, text: string): Promise<ProviderSendResult>;
  sendMedia(conversation: MessengerConversation, attachment: OutgoingMediaAttachment, caption?: string): Promise<ProviderSendResult>;
  downloadAttachment?(attachment: MessageAttachment): Promise<ProviderMediaDownload>;
  configureWebhook?(webhookUrl: string): Promise<void>;
  pullIncoming?(): Promise<NormalizedIncomingMessage[]>;
  normalizeWebhook(payload: unknown): NormalizedIncomingMessage[];
};
