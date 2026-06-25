# OptiAI CRM

Revenue Operating System для продаж SEO + GEO на автопилоте.

Проект собран по ТЗ:

- Backend: PostgreSQL, Supabase, API-first.
- Frontend: Next.js, React, Tailwind.
- CRM-механики: воронка, карточка компании, аккаунты, роли, задачи, звонки, AI-summary, прогревы, подписки, платежи, продления, интеграции.

## Запуск

```bash
npm install
npm run dev
```

Открыть: `http://localhost:3000`.

Без Supabase-ключей продукт работает в demo-mode через Next API и in-memory CRM-store. Это нужно, чтобы интерфейс, API-действия и бизнес-логика были доступны сразу.

## Вход в CRM

В локальном demo-mode включен вход по email и паролю через HTTP-only cookie-сессию. Список аккаунтов и паролей не показывается на странице входа.

Новые сотрудники создаются руководителем во вкладке `Команда` с временным паролем. После выхода они могут войти уже под своим email.

Для production нужно задать `AUTH_SECRET` в `.env.local`. При HTTPS также выставить `AUTH_COOKIE_SECURE=true`.

При подключении Supabase эти аккаунты следует перенести в Supabase Auth, а поле `crm_users.auth_user_id` связать с `auth.users.id`. Подробно: `supabase/AUTH_SETUP.md`.

## Supabase

1. Создать Supabase project.
2. Скопировать `.env.example` в `.env.local`.
3. Заполнить:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Выполнить SQL:

```text
supabase/migrations/0001_initial_schema.sql
supabase/seed.sql
```

Схема содержит:

- `crm_users` - аккаунты руководителя, РОПа, менеджеров, аккаунт-менеджеров;
- `companies`, `contacts`, `leads` - карточка компании и лид;
- `pipeline_stages` - 13 этапов из ТЗ;
- `tasks` - задачи менеджеров и автоматизаций;
- `activities` - история коммуникаций;
- `call_records` - запись, расшифровка, summary, возражения, вероятность сделки;
- `warmup_sequences`, `warmup_steps`, `warmup_assignments` - система прогрева;
- `subscriptions`, `payments` - подписки, платежи, продления;
- `integrations` - Telegram, WhatsApp, MAX, Instagram, Avito, Google Sheets, Яндекс Метрика, RoboKassa, SIP.

RLS-политики ограничивают доступ:

- Руководитель: полный доступ;
- РОП: управление продажами и командой;
- Менеджер: свои сделки;
- Аккаунт-менеджер: действующие клиенты.

## API-first слой

Клиент работает через API:

- `GET /api/crm/bootstrap?userId=...` - состояние CRM, отфильтрованное по роли;
- `POST /api/crm/actions` - бизнес-действия:
  - `create_user`;
  - `create_lead`;
  - `move_stage`;
  - `assign_lead`;
  - `record_call`;
  - `send_message`;
  - `start_warmup`;
  - `create_warmup_step`;
  - `mark_paid`;
  - `mark_refused`;
  - `renew_subscription`;
  - `run_automation`;
  - `toggle_integration`.

## Рабочий сценарий менеджера

1. Открыть CRM утром.
2. Выбрать свой аккаунт.
3. Перейти в `Воронка` или `Call Center`.
4. Сделать звонки из списка.
5. AI автоматически заполняет карточку, summary, боль, возражения, следующий шаг.
6. CRM запускает прогрев или ставит задачу.
7. Руководитель видит прогноз, MRR, Churn, LTV, конверсии и статус каждого клиента.
