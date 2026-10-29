-- Effective application roles from OptiAI CRM TZ v1.1:
-- Руководитель, Менеджер по продажам, Технический специалист.
-- PostgreSQL keeps the legacy enum value "Менеджер" as the storage alias for
-- "Менеджер по продажам" so existing functions and data remain compatible.

update public.crm_users
set role = 'Менеджер'::public.crm_role,
    updated_at = now()
where role::text in ('РОП', 'Аккаунт-менеджер');

insert into public.os_user_settings (user_id, app_permissions, auto_assign_enabled)
select
  id,
  case role::text
    when 'Руководитель' then array['leads','management','content','routines','settings','team']
    when 'Технический специалист' then array['leads','settings']
    else array['leads']
  end,
  role::text = 'Менеджер' and status::text = 'active'
from public.crm_users
on conflict (user_id) do update
set app_permissions = excluded.app_permissions,
    auto_assign_enabled = case
      when (select role::text from public.crm_users where id = excluded.user_id) = 'Менеджер'
        then public.os_user_settings.auto_assign_enabled
      else false
    end,
    updated_at = now();

create or replace function public.initialize_os_user_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.os_user_settings (user_id, app_permissions, auto_assign_enabled)
  values (
    new.id,
    case new.role::text
      when 'Руководитель' then array['leads','management','content','routines','settings','team']
      when 'Технический специалист' then array['leads','settings']
      else array['leads']
    end,
    new.role::text = 'Менеджер' and new.status::text = 'active'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop policy if exists "role based lead read" on public.leads;
create policy "role based lead read" on public.leads for select to authenticated using (
  public.current_crm_role() in ('Руководитель', 'Менеджер', 'Технический специалист')
);
