export type AiProvider = "openai" | "anthropic" | "gemini";

export type AiMessagingChannel = "telegram" | "whatsapp" | "max";

export type AiCallAnalysis = {
  summary: string;
  pain: string;
  currentPromotionChannels: string;
  budget: string;
  objections: string[];
  nextSteps: string[];
  suggestedWarmupContent: string;
  interest: number;
  dealProbability: number;
  managerMistakes: string[];
};

export type AiConfigurationSummary = {
  configured: boolean;
  provider?: AiProvider;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  autoReplyEnabled: boolean;
  warmupEnabled: boolean;
  channels: AiMessagingChannel[];
  companyContext: string;
  replyInstructions: string;
};

export type AiConversationDecision = {
  action: "reply" | "handoff" | "ignore";
  message: string;
  reason: string;
};
