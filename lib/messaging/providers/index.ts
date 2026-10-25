import type { MessengerChannel, ProviderAdapter } from "../types";
import { maxAdapter } from "./max";
import { telegramAdapter } from "./telegram";
import { whatsappAdapter } from "./whatsapp";
import { instagramAdapter } from "./instagram";
import { avitoAdapter } from "./avito";

const adapters: Record<MessengerChannel, ProviderAdapter> = {
  telegram: telegramAdapter,
  whatsapp: whatsappAdapter,
  max: maxAdapter,
  instagram: instagramAdapter,
  avito: avitoAdapter
};

export function providerFor(channel: MessengerChannel) {
  return adapters[channel];
}
