# Supabase Auth для OptiAI CRM

Локальный demo-mode использует Next API login/password и HTTP-only cookie.

В production рекомендуется использовать Supabase Auth:

1. Создать пользователей в Supabase Authentication:
   - `owner@optiai.ru`
   - `rop@optiai.ru`

2. В `auth.users.raw_app_meta_data` добавить роль:

```json
{
  "crm_role": "Руководитель"
}
```

Допустимые роли:

- `Руководитель`
- `РОП`
- `Менеджер`
- `Аккаунт-менеджер`

3. В таблице `public.crm_users` заполнить `auth_user_id` соответствующим `auth.users.id`.

4. RLS-политики из `migrations/0001_initial_schema.sql` начнут ограничивать данные:

- руководитель и РОП видят команду и продажи;
- менеджер видит свои сделки;
- аккаунт-менеджер видит действующих клиентов;
- системные таблицы доступны по роли.

5. Для HTTPS production выставить:

```env
AUTH_COOKIE_SECURE=true
AUTH_SECRET=<long-random-secret>
```
