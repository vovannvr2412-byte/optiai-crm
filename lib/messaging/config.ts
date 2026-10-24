import type { MessengerChannel, MessengerConnection } from "./types";

const channelConfig: Record<MessengerChannel, {
  name: string;
  required: string[];
  webhook: string[];
}> = {
  telegram: {
    name: "Telegram Bot API",
    required: ["TELEGRAM_BOT_TOKEN"],
    webhook: ["TELEGRAM_WEBHOOK_SECRET"]
  },
  whatsapp: {
    name: "WhatsApp Business Cloud API",
    required: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    webhook: ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"]
  },
  max: {
    name: "MAX Bot API",
    required: ["MAX_BOT_TOKEN"],
    webhook: ["MAX_WEBHOOK_SECRET"]
  }
};

export const messengerChannels = Object.keys(channelConfig) as MessengerChannel[];

export function isMessengerChannel(value: string): value is MessengerChannel {
  return messengerChannels.includes(value as MessengerChannel);
}

export function connectionFromConfiguration(channel: MessengerChannel, saved?: Partial<MessengerConnection>, configuredFields: Record<string, boolean> = {}) {
  const definition = channelConfig[channel];
  const configured = definition.required.every((key) => Boolean(configuredFields[key]));
  const webhookConfigured = definition.webhook.every((key) => Boolean(configuredFields[key]));
  let status: MessengerConnection["status"] = configured ? "needs_setup" : "not_configured";
  if (configured && saved?.status === "connected") status = "connected";
  if (configured && saved?.status === "error") status = "error";

  return {
    id: channel,
    channel,
    name: definition.name,
    status,
    configured,
    webhookConfigured,
    configuredFields,
    requiredEnv: [...definition.required, ...definition.webhook],
    externalAccountId: saved?.externalAccountId,
    externalAccountUsername: saved?.externalAccountUsername,
    lastSyncAt: saved?.lastSyncAt,
    lastErrorAt: saved?.lastErrorAt,
    lastError: saved?.lastError
  };
}

export function safeProviderError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[скрыто]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [скрыто]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[скрыто]")
    .slice(0, 500);
}
