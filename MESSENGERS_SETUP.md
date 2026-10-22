# Подключение мессенджеров OptiAI CRM

Модуль хранит диалоги и сообщения локально в `data/messaging-state.json`, когда включён `CRM_FORCE_LOCAL=true`. В production с настроенным Supabase используются таблицы из миграции `supabase/migrations/0002_messaging_center.sql`.

## Общая настройка

1. Выполните миграцию `0002_messaging_center.sql` в Supabase SQL Editor.
2. Добавьте переменные из `.env.example` в `.env.local` и в Vercel: Project → Settings → Environment Variables.
3. Не используйте префикс `NEXT_PUBLIC_` для токенов и webhook-секретов.
4. После изменения переменных перезапустите локальный сервер или сделайте Redeploy в Vercel.
5. Webhook должен быть доступен по публичному HTTPS-адресу.

## Telegram

1. Создайте бота через `@BotFather` и сохраните токен в `TELEGRAM_BOT_TOKEN`.
2. Создайте случайный секрет из символов `A-Z`, `a-z`, `0-9`, `_`, `-` и сохраните в `TELEGRAM_WEBHOOK_SECRET`.
3. Установите webhook методом `setWebhook` на `https://ВАШ-ДОМЕН/api/messaging/webhooks/telegram`, передав тот же `secret_token`.
4. В CRM откройте «Автоматизации» → «Мессенджеры» → Telegram → «Проверить».
5. Напишите боту. Диалог появится в разделе «Мессенджеры».

Бот видит только события в чатах, к которым ему предоставлен доступ. Он не читает произвольные личные переписки сотрудников.

## WhatsApp Business Cloud API

1. В Meta for Developers создайте приложение Business, добавьте WhatsApp и подключите номер.
2. Сохраните постоянный access token в `WHATSAPP_ACCESS_TOKEN`, Phone Number ID в `WHATSAPP_PHONE_NUMBER_ID`, App Secret в `WHATSAPP_APP_SECRET`.
3. Придумайте проверочный токен и сохраните его в `WHATSAPP_VERIFY_TOKEN`.
4. В настройках webhook укажите `https://ВАШ-ДОМЕН/api/messaging/webhooks/whatsapp`, проверочный токен и подпишитесь на поле `messages`.
5. Проверьте подключение из CRM и отправьте входящее сообщение на бизнес-номер.

Исходящие сообщения подчиняются 24-часовому окну обслуживания и правилам шаблонов WhatsApp. CRM не обходит эти ограничения; ошибки Cloud API сохраняются у сообщения.

## MAX

1. Создайте бота на платформе MAX для партнёров и сохраните токен в `MAX_BOT_TOKEN`.
2. Создайте секрет длиной 5–256 символов из разрешённых символов и сохраните в `MAX_WEBHOOK_SECRET`.
3. Вызовите `POST https://platform-api2.max.ru/subscriptions` с заголовком `Authorization: <токен>` и телом:

```json
{
  "url": "https://ВАШ-ДОМЕН/api/messaging/webhooks/max",
  "update_types": ["message_created", "bot_started"],
  "secret": "ВАШ_MAX_WEBHOOK_SECRET"
}
```

4. Проверьте подключение из CRM и напишите боту.

Для production MAX требует HTTPS webhook на порту 443 и доверенный TLS-сертификат. Актуальный API использует домен `platform-api2.max.ru`.

## Проверка

- В настройках канал должен перейти из «Не настроен» в «Подключён» только после успешного ответа API.
- Входящее сообщение должно создать один диалог и одно сообщение. Повторная доставка того же события не создаёт копию.
- Исходящее сообщение сначала сохраняется со статусом `pending`, затем получает `sent` либо `failed` с безопасным описанием ошибки.
- Для проверки на локальном компьютере нужен HTTPS-туннель. `localhost` провайдеры вызвать не смогут.
