# Supabase Auth для OptiAI CRM

## Подключение

1. Выполнить `migrations/0004_normalized_crm_and_auth.sql` в Supabase SQL Editor.
2. В `Authentication -> Providers` оставить включённым провайдер Email.
3. В `Authentication -> URL Configuration` указать production Site URL проекта Vercel и добавить `http://localhost:3000` в Redirect URLs для разработки.
4. Для HTTPS production выставить:

```env
AUTH_COOKIE_SECURE=true
AUTH_SECRET=<long-random-secret>
CRM_FORCE_LOCAL=false
```

Вручную создавать пользователей в Authentication не требуется. При первом входе существующего сотрудника CRM проверяет старый хеш пароля, создаёт пользователя Supabase Auth, записывает роль в `app_metadata.crm_role` и связывает его с `public.crm_users.auth_user_id`. Старый хеш после успешного переноса удаляется.

Новые сотрудники создаются руководителем или РОПом через раздел `Команда` и сразу получают связанную учётную запись Supabase Auth. При отключении сотрудник блокируется в Auth, при удалении его учётная запись Auth удаляется.

Допустимые роли:

- `Руководитель`
- `РОП`
- `Менеджер`
- `Аккаунт-менеджер`

RLS-политики ограничивают доступ по `app_metadata.crm_role`, а Next.js API дополнительно проверяет роль и назначенного ответственного.

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
