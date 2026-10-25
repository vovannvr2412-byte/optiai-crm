import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { publicSiteUrl } from "@/lib/auth/urls";
import { getCrmStateAsync, setIntegrationStatusAsync } from "@/lib/crm/store";
import { isMessengerChannel, safeProviderError } from "@/lib/messaging/config";
import { archiveExistingTelegramMedia } from "@/lib/messaging/media-archive";
import { deleteTelegramWebhook, inspectTelegramBot, setTelegramWebhook } from "@/lib/messaging/providers/telegram";
import { providerFor } from "@/lib/messaging/providers";
import { deleteMessengerSecrets, getMessengerSecrets, messengerSecretFields, replaceMessengerSecrets, saveMessengerSecrets } from "@/lib/messaging/secrets";
import { activateTelegramBot, assertTelegramReplacementSchema, listConnections, resetConnectionStatus, saveConnectionCheck } from "@/lib/messaging/store";
import { recordSecurityAuditSafe } from "@/lib/security/audit";
import type { MessengerConnection } from "@/lib/messaging/types";

const schema = z.object({ config: z.record(z.string(), z.string().max(12000)) });

async function ownerFromSession() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const state = await getCrmStateAsync();
  return state.users.find((item) => item.id === userId && item.status === "active" && item.role === "Руководитель") ?? null;
}

export async function PUT(request: Request, context: { params: Promise<{ channel: string }> }) {
  const owner = await ownerFromSession();
  if (!owner) return NextResponse.json({ error: "Настройки ботов может менять только руководитель." }, { status: 403 });
  const { channel } = await context.params;
  if (!isMessengerChannel(channel)) return NextResponse.json({ error: "Неизвестный канал." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте значения полей." }, { status: 400 });
  const allowed = new Set(messengerSecretFields[channel]);
  const sanitized = Object.fromEntries(Object.entries(parsed.data.config).filter(([key]) => allowed.has(key)));
  try {
    if (channel === "telegram") {
      let previousSecrets: Record<string, string> = {};
      let discardedUnreadableSecrets = false;
      try {
        previousSecrets = await getMessengerSecrets("telegram");
      } catch {
        discardedUnreadableSecrets = true;
      }
      const nextSecrets = { ...previousSecrets, ...sanitized };
      const botToken = nextSecrets.TELEGRAM_BOT_TOKEN?.trim();
      const webhookSecret = nextSecrets.TELEGRAM_WEBHOOK_SECRET?.trim();
      if (!botToken) return NextResponse.json({ error: "Добавьте Bot Token нового Telegram-бота." }, { status: 400 });
      if (!webhookSecret) return NextResponse.json({ error: "Добавьте Webhook Secret для защищённого подключения Telegram." }, { status: 400 });
      await assertTelegramReplacementSchema();

      let previousConnection: MessengerConnection | undefined;
      try {
        previousConnection = (await listConnections()).find((item) => item.channel === "telegram");
      } catch {
        if (!discardedUnreadableSecrets) throw new Error("Не удалось прочитать текущее подключение Telegram.");
      }
      const profile = await inspectTelegramBot(botToken);
      const tokenChanged = Boolean(previousSecrets.TELEGRAM_BOT_TOKEN && previousSecrets.TELEGRAM_BOT_TOKEN !== botToken);
      let previousExternalAccountId = previousConnection?.externalAccountId;
      if (!previousExternalAccountId && tokenChanged) {
        try {
          previousExternalAccountId = (await inspectTelegramBot(previousSecrets.TELEGRAM_BOT_TOKEN)).id;
        } catch {
          // A revoked old token cannot identify itself. A token change is treated as a bot replacement.
        }
      }
      const webhookUrl = new URL("/api/messaging/webhooks/telegram", publicSiteUrl(request)).toString();
      const canRegisterWebhook = webhookUrl.startsWith("https://");
      const mediaArchive = tokenChanged && previousSecrets.TELEGRAM_BOT_TOKEN
        ? await archiveExistingTelegramMedia(previousSecrets.TELEGRAM_BOT_TOKEN, new URL(request.url).origin)
        : { archived: 0, failed: 0, failures: [] as string[] };

      await replaceMessengerSecrets("telegram", nextSecrets, { discardUnreadable: discardedUnreadableSecrets });
      let replacement: Awaited<ReturnType<typeof activateTelegramBot>>;
      try {
        if (canRegisterWebhook) await setTelegramWebhook(botToken, webhookUrl, webhookSecret);
        replacement = await activateTelegramBot({
          externalAccountId: profile.id,
          externalAccountUsername: profile.username,
          previousExternalAccountId,
          forceReconnect: discardedUnreadableSecrets || (tokenChanged && !previousExternalAccountId)
        });
      } catch (error) {
        try {
          await replaceMessengerSecrets("telegram", previousSecrets, { discardUnreadable: true });
          if (canRegisterWebhook && previousSecrets.TELEGRAM_BOT_TOKEN && previousSecrets.TELEGRAM_WEBHOOK_SECRET) {
            await setTelegramWebhook(previousSecrets.TELEGRAM_BOT_TOKEN, webhookUrl, previousSecrets.TELEGRAM_WEBHOOK_SECRET);
          } else if (canRegisterWebhook) {
            await deleteTelegramWebhook(botToken);
          }
        } catch (rollbackError) {
          console.error("Telegram bot replacement rollback failed", { message: safeProviderError(rollbackError) });
        }
        throw error;
      }

      if (replacement.switchedBot && previousSecrets.TELEGRAM_BOT_TOKEN && previousSecrets.TELEGRAM_BOT_TOKEN !== botToken) {
        try {
          await deleteTelegramWebhook(previousSecrets.TELEGRAM_BOT_TOKEN);
        } catch (error) {
          console.error("Previous Telegram webhook cleanup failed", { message: safeProviderError(error) });
        }
      }

      await recordSecurityAuditSafe(owner, "messenger.bot_replaced", "messenger_connection", channel, {
        fields: Object.keys(sanitized).sort(),
        replacedBot: replacement.switchedBot,
        conversationsUpdated: replacement.conversationsUpdated,
        webhookRegistered: canRegisterWebhook,
        discardedUnreadableSecrets,
        mediaArchived: mediaArchive.archived,
        mediaArchiveFailed: mediaArchive.failed
      });
      await setIntegrationStatusAsync(channel, "connected");
      const botLabel = profile.username ? `@${profile.username}` : profile.displayName;
      const reconnectMessage = replacement.conversationsAwaitingStart
        ? ` ${replacement.conversationsAwaitingStart} диалогов сохранили историю и ожидают /start у нового бота.`
        : " История диалогов сохранена.";
      return NextResponse.json({
        connection: replacement.connection,
        replacement: {
          replacedBot: replacement.switchedBot,
          conversationsUpdated: replacement.conversationsUpdated,
          conversationsAwaitingStart: replacement.conversationsAwaitingStart,
          webhookRegistered: canRegisterWebhook,
          discardedUnreadableSecrets,
          mediaArchived: mediaArchive.archived,
          mediaArchiveFailed: mediaArchive.failed
        },
        message: `Telegram-бот ${botLabel} подключён.${reconnectMessage}${mediaArchive.archived ? ` Старых медиафайлов перенесено в CRM: ${mediaArchive.archived}.` : ""}${mediaArchive.failed ? ` Не удалось перенести файлов: ${mediaArchive.failed}; они останутся в истории, но могут быть недоступны после отключения старого бота.` : ""}${canRegisterWebhook ? " Webhook обновлён автоматически." : " На localhost webhook нужно зарегистрировать через публичный HTTPS-адрес."}${discardedUnreadableSecrets ? " Старые зашифрованные ключи были недоступны и заменены; другие каналы нужно настроить повторно." : ""}`
      });
    }

    let replacedUnreadableSecrets = false;
    try {
      await saveMessengerSecrets(channel, sanitized);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Не удалось расшифровать настройки")) throw error;
      await replaceMessengerSecrets(channel, sanitized, { discardUnreadable: true });
      replacedUnreadableSecrets = true;
    }
    await resetConnectionStatus(channel);
    const adapter = providerFor(channel);
    const result = await adapter.checkConnection();
    if (!result.ok) {
      const connection = await saveConnectionCheck(channel, result);
      await setIntegrationStatusAsync(channel, "error");
      return NextResponse.json({ connection, error: result.message }, { status: 424 });
    }
    const webhook = new URL(`/api/messaging/webhooks/${channel}`, publicSiteUrl(request));
    if (channel === "avito") webhook.searchParams.set("secret", (await getMessengerSecrets("avito")).AVITO_WEBHOOK_SECRET || "");
    if (webhook.protocol === "https:" && adapter.configureWebhook) await adapter.configureWebhook(webhook.toString());
    const connection = await saveConnectionCheck(channel, result);
    await setIntegrationStatusAsync(channel, "connected");
    await recordSecurityAuditSafe(owner, "messenger.credentials_updated", "messenger_connection", channel, { fields: Object.keys(sanitized).sort() });
    return NextResponse.json({
      connection,
      message: `Подключение проверено, ключи сохранены.${webhook.protocol === "https:" && adapter.configureWebhook ? " Webhook зарегистрирован." : " Для webhook нужен публичный HTTPS-адрес."}${replacedUnreadableSecrets ? " Недоступные старые ключи этого канала заменены." : ""}`
    });
  } catch (error) {
    return NextResponse.json({ error: safeProviderError(error) || "Не удалось сохранить настройки." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ channel: string }> }) {
  const owner = await ownerFromSession();
  if (!owner) return NextResponse.json({ error: "Настройки ботов может менять только руководитель." }, { status: 403 });
  const { channel } = await context.params;
  if (!isMessengerChannel(channel)) return NextResponse.json({ error: "Неизвестный канал." }, { status: 404 });
  try {
    await deleteMessengerSecrets(channel);
    await resetConnectionStatus(channel);
    await setIntegrationStatusAsync(channel, "needs_setup");
    const connection = (await listConnections()).find((item) => item.channel === channel);
    await recordSecurityAuditSafe(owner, "messenger.credentials_deleted", "messenger_connection", channel);
    return NextResponse.json({ connection, message: "Настройки CRM удалены. Переменные Vercel, если они заданы, снова используются как резерв." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сбросить настройки." }, { status: 500 });
  }
}
