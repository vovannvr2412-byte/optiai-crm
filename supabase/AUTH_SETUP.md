# Supabase Auth для OptiAI CRM

## Подключение

1. Выполнить `migrations/0004_normalized_crm_and_auth.sql`, затем `migrations/0005_single_company_security.sql` в Supabase SQL Editor.
2. В `Authentication -> Providers` оставить включённым провайдер Email.
3. В `Authentication -> URL Configuration` указать production Site URL проекта Vercel.
4. В Redirect URLs добавить `https://<домен-vercel>/set-password` и `http://localhost:3000/set-password`.
5. Для самостоятельного восстановления пароля сотрудниками подключить собственный SMTP в `Authentication -> Email`. Создание аккаунта руководителем от SMTP не зависит.
6. Для HTTPS production выставить:

```env
AUTH_COOKIE_SECURE=true
AUTH_SECRET=<long-random-secret>
CRM_FORCE_LOCAL=false
NEXT_PUBLIC_SITE_URL=https://<домен-vercel>
```

Опционально можно задать `DIAGNOSTICS_TOKEN`. В production `/api/diagnostics` доступен руководителю с активной сессией или по заголовку `Authorization: Bearer <DIAGNOSTICS_TOKEN>`.

Вручную создавать пользователей в Authentication не требуется. При первом входе существующего сотрудника CRM проверяет старый хеш пароля, создаёт пользователя Supabase Auth, записывает роль в `app_metadata.crm_role` и связывает его с `public.crm_users.auth_user_id`. Старый хеш после успешного переноса удаляется.

Новые аккаунты создаются через раздел `Команда`. Руководитель может создавать любые роли, РОП - менеджеров и аккаунт-менеджеров. Создатель указывает временный пароль, который сразу передаётся в Supabase Auth, но не сохраняется в CRM. После входа сотрудник меняет пароль через кнопку `Сменить пароль`. При отключении сотрудник блокируется в Auth, его открытые задачи и сделки переназначаются. При удалении учётная запись Auth удаляется, а история звонков сохраняется.

На странице входа сотрудник может запросить восстановление пароля. Ответ не сообщает, существует ли такой email. После смены пароля Supabase отзывает остальные сессии и требует войти заново.

Допустимые роли:

- `Руководитель`
- `РОП`
- `Менеджер`
- `Аккаунт-менеджер`

RLS определяет актуальную роль по связке `auth.users -> crm_users`, поэтому смена статуса применяется без ожидания обновления JWT. Next.js API дополнительно проверяет роль и назначенного ответственного.

## Проверка переноса

```sql
select key, updated_at
from public.crm_app_state
where key in ('crm_state_backup_v1', 'normalized_storage_v1');

select count(*) from public.crm_users;
select count(*) from public.leads;
select count(*) from public.tasks;
select count(*) from auth.users;
```

После настройки `.env.local` полную проверку RLS можно повторить командой:

```bash
npm run test:security:live
```

Тест временно создаёт пользователей всех четырёх ролей и контрольные лиды, проверяет права через пользовательские JWT, а затем удаляет все созданные записи.
