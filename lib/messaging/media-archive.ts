import { persistMessengerMedia } from "@/lib/media/storage";
import { downloadTelegramAttachment } from "./providers/telegram";
import { listUnarchivedTelegramMedia, saveMessageAttachments } from "./store";
import type { MessageAttachment } from "./types";

export async function archiveTelegramAttachments(
  attachments: MessageAttachment[],
  botToken: string,
  baseUrl: string
) {
  let archived = 0;
  const next = await Promise.all(attachments.map(async (attachment) => {
    if (attachment.url || !attachment.externalId || (attachment.type !== "image" && attachment.type !== "video")) return attachment;
    const media = await downloadTelegramAttachment(botToken, attachment);
    const url = await persistMessengerMedia({ bytes: media.body, mimeType: media.mimeType, baseUrl });
    archived += 1;
    return { ...attachment, url, mimeType: media.mimeType, name: attachment.name ?? media.fileName };
  }));
  return { attachments: next, archived };
}

export async function archiveExistingTelegramMedia(botToken: string, baseUrl: string) {
  const messages = await listUnarchivedTelegramMedia();
  let archived = 0;
  const failures: string[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < messages.length) {
      const message = messages[cursor++];
      try {
        const result = await archiveTelegramAttachments(message.attachments, botToken, baseUrl);
        if (result.archived) {
          await saveMessageAttachments(message.id, result.attachments);
          archived += result.archived;
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Не удалось сохранить вложение.");
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, messages.length) }, () => worker()));

  return { archived, failed: failures.length, failures: [...new Set(failures)].slice(0, 3) };
}
