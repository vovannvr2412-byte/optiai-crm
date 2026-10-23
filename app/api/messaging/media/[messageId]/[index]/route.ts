import { getSessionUserId } from "@/lib/auth/session";
import { providerFor } from "@/lib/messaging/providers";
import { getMessageForUser } from "@/lib/messaging/store";
import { safeProviderError } from "@/lib/messaging/config";

export async function GET(_request: Request, context: { params: Promise<{ messageId: string; index: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  try {
    const { messageId, index } = await context.params;
    const message = await getMessageForUser(userId, messageId);
    const attachment = message.attachments[Number(index)];
    if (!attachment) return new Response("Not found", { status: 404 });
    if (attachment.url) return Response.redirect(attachment.url, 307);
    const adapter = providerFor(message.channel);
    if (!adapter.downloadAttachment) return new Response("Media is unavailable", { status: 404 });
    const media = await adapter.downloadAttachment(attachment);
    const headers: Record<string, string> = {
      "Content-Type": media.mimeType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff"
    };
    if (media.fileName) headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`;
    return new Response(media.body, { headers });
  } catch (error) {
    return new Response(safeProviderError(error), { status: 404 });
  }
}
