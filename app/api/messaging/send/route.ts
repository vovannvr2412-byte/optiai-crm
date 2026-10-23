import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { providerFor } from "@/lib/messaging/providers";
import { createPendingMessage, finishOutgoingMessage, getConversationForUser } from "@/lib/messaging/store";
import { safeProviderError } from "@/lib/messaging/config";
import { isTrustedMediaUrl } from "@/lib/media/storage";

const schema = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().max(4000).default(""),
  attachment: z.object({
    type: z.enum(["image", "video"]),
    url: z.string().url(),
    name: z.string().max(255).optional(),
    mimeType: z.string().max(100).optional()
  }).optional(),
  idempotencyKey: z.string().min(8).max(200).optional()
}).refine((value) => Boolean(value.text || value.attachment), { message: "Добавьте текст или файл." });

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Добавьте текст, фото или видео." }, { status: 400 });
  if (parsed.data.attachment && !isTrustedMediaUrl(parsed.data.attachment.url, request.url)) {
    return NextResponse.json({ error: "Сначала загрузите файл через CRM." }, { status: 400 });
  }

  try {
    const conversation = await getConversationForUser(userId, parsed.data.conversationId);
    const message = await createPendingMessage(userId, conversation.id, parsed.data.text, parsed.data.idempotencyKey ?? randomUUID(), parsed.data.attachment);
    const adapter = providerFor(conversation.channel);
    if (!await adapter.isConfigured()) {
      const failed = await finishOutgoingMessage(message.id, { status: "failed", errorReason: `${conversation.channel}: подключение не настроено на сервере.` });
      return NextResponse.json({ message: failed, error: failed.errorReason }, { status: 424 });
    }
    try {
      const result = parsed.data.attachment
        ? await adapter.sendMedia(conversation, parsed.data.attachment, message.text || undefined)
        : await adapter.sendText(conversation, message.text);
      const sent = await finishOutgoingMessage(message.id, result);
      return NextResponse.json({ message: sent });
    } catch (error) {
      const reason = safeProviderError(error);
      const failed = await finishOutgoingMessage(message.id, { status: "failed", errorReason: reason });
      return NextResponse.json({ message: failed, error: reason }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: safeProviderError(error) }, { status: 400 });
  }
}
