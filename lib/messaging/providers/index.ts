import type { MessengerChannel, ProviderAdapter } from "../types";
import { maxAdapter } from "./max";
import { telegramAdapter } from "./telegram";
import { whatsappAdapter } from "./whatsapp";

const adapters: Record<MessengerChannel, ProviderAdapter> = {
  telegram: telegramAdapter,
  whatsapp: whatsappAdapter,
  max: maxAdapter
};

export function providerFor(channel: MessengerChannel) {
  return adapters[channel];
}
