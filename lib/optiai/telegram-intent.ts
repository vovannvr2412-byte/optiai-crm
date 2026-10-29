type TelegramIntentMessage = {
  channel: string;
  text: string;
  metadata?: Record<string, string | number | boolean | null>;
};

const managerCallCommands = new Set([
  "/call",
  "/callback",
  "/manager",
  "/request_call",
  "manager_call_requested"
]);

const managerCallPhrases = new Set([
  "позвонить мне",
  "связаться с менеджером",
  "запросить звонок",
  "запросить звонок менеджера",
  "нужен звонок менеджера"
]);

function normalizedIntent(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}

export function isTelegramManagerCallRequest(message: TelegramIntentMessage) {
  if (message.channel !== "telegram" || message.metadata?.chatType !== "private") return false;
  const callback = normalizedIntent(String(message.metadata?.callbackData ?? ""));
  if (managerCallCommands.has(callback)) return true;
  const text = normalizedIntent(message.text);
  const command = text.split(/\s/, 1)[0]?.replace(/@[^\s]+$/, "") ?? "";
  return managerCallCommands.has(command) || managerCallPhrases.has(text);
}
