# Задачи и автоматизации OptiAI CRM

## 1. Миграция Supabase

После миграций `0001`-`0005` целиком выполнить в Supabase SQL Editor:

```text
supabase/migrations/0006_tasks_and_automations.sql
```

Повторный запуск файла безопасен. Миграция создаёт:

- `crm_notifications` - постоянные уведомления сотрудников;
- `automation_events` - идемпотентный журнал событий и повторных попыток;
- `automation_runs` - история запусков планировщика;
- `claim_automation_event(...)` - атомарный захват события одним обработчиком.

## 2. Секрет планировщика

Создать случайную строку длиной не менее 32 символов и добавить одинаковое значение:

```env
CRON_SECRET=<случайный-секрет>
```

- локально: в `.env.local`;
- Vercel: `Project -> Settings -> Environment Variables`, окружение `Production`.

После изменения переменных выполнить Redeploy последнего production deployment. Секрет нельзя добавлять в Git и нельзя называть `NEXT_PUBLIC_CRON_SECRET`.

## 3. Расписание

Файл `vercel.json` регистрирует ежедневный запрос:

```text
GET /api/cron/automations
0 6 * * *
```

Это 06:00 UTC, то есть 09:00 по московскому времени. Vercel передаёт `CRON_SECRET` в заголовке `Authorization: Bearer ...`. Повторный или параллельный запуск не дублирует сообщение, задачу либо уведомление благодаря уникальному `event_key`.

## 4. Проверка

После деплоя открыть `Project -> Cron Jobs` в Vercel и убедиться, что задача `/api/cron/automations` активна. Ручная проверка из PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Uri "https://<домен>/api/cron/automations" -Headers $headers
```

Ответ содержит `ok: true`, идентификатор запуска и счётчики. Без заголовка endpoint должен отвечать `401`.

## 5. Уведомления на устройстве

Уведомления всегда сохраняются внутри CRM. Для системных уведомлений браузера сотрудник один раз нажимает `Включить уведомления на устройстве` в меню колокольчика и разрешает уведомления для домена.
