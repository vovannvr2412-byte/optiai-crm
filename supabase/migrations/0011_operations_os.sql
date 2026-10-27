do $$
begin
  alter type public.crm_role add value if not exists 'Технический специалист';
exception when duplicate_object then null;
end $$;

create table if not exists public.os_user_settings (
  user_id uuid primary key references public.crm_users(id) on delete cascade,
  app_permissions text[] not null default '{}',
  auto_assign_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.os_user_settings (user_id, app_permissions, auto_assign_enabled)
select
  id,
  case role::text
    when 'Руководитель' then array['leads','management','content','routines','settings','team']
    when 'РОП' then array['leads','routines','team']
    when 'Менеджер' then array['leads']
    when 'Аккаунт-менеджер' then array['leads','management']
    else array['leads','settings','routines']
  end,
  role::text in ('Менеджер', 'РОП') and status::text = 'active'
from public.crm_users
on conflict (user_id) do nothing;

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
      when 'РОП' then array['leads','routines','team']
      when 'Менеджер' then array['leads']
      when 'Аккаунт-менеджер' then array['leads','management']
      else array['leads','settings','routines']
    end,
    new.role::text in ('Менеджер', 'РОП') and new.status::text = 'active'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_os_user_settings_after_user on public.crm_users;
create trigger initialize_os_user_settings_after_user
after insert on public.crm_users
for each row execute function public.initialize_os_user_settings();

create table if not exists public.lead_os_profiles (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  project_name text not null default '',
  optiai_account_id text,
  optiai_login text,
  preferred_channel text check (preferred_channel is null or preferred_channel in ('telegram','max','whatsapp','phone','email')),
  telegram_id text,
  max_contact text,
  whatsapp_contact text,
  substatus text check (substatus is null or substatus in ('Не отвечает','Отложено')),
  expected_payment_at date,
  original_owner_id uuid references public.crm_users(id) on delete set null,
  scripts_sent boolean not null default false,
  scripts_sent_at timestamptz,
  scripts_sent_by uuid references public.crm_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_os_profiles_optiai_account_unique
  on public.lead_os_profiles(optiai_account_id)
  where optiai_account_id is not null and optiai_account_id <> '';

create table if not exists public.lead_source_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  external_event_id text not null unique,
  source text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_activation_checks (
  lead_id uuid not null references public.leads(id) on delete cascade,
  code text not null check (code in ('questionnaire_sent','questionnaire_received','integration_completed','keywords_approved','subscription_activated','days_added')),
  completed_at timestamptz,
  completed_by uuid references public.crm_users(id) on delete set null,
  not_applicable boolean not null default false,
  primary key (lead_id, code)
);

alter table public.tasks add column if not exists due_time time;
alter table public.tasks add column if not exists task_type text not null default 'other'
  check (task_type in ('call','message','audit','case','proposal','other'));
alter table public.tasks add column if not exists description text not null default '';
alter table public.tasks add column if not exists result text;
alter table public.tasks add column if not exists manual_override boolean not null default false;
alter table public.tasks add column if not exists source text not null default 'manual'
  check (source in ('manual','warmup','automation','platform'));
alter table public.tasks add column if not exists history jsonb not null default '[]'::jsonb;

alter table public.call_records add column if not exists call_result text
  check (call_result is null or call_result in ('answered','no_answer','busy','invalid_number','other'));
alter table public.call_records add column if not exists duration_seconds integer not null default 0 check (duration_seconds >= 0);
alter table public.call_records add column if not exists external_id text;
create unique index if not exists call_records_external_id_unique on public.call_records(external_id) where external_id is not null;

alter table public.payments add column if not exists external_event_id text;
alter table public.payments add column if not exists is_first_payment boolean not null default false;
create unique index if not exists payments_external_event_unique on public.payments(external_event_id) where external_event_id is not null;
alter table public.subscriptions add column if not exists external_id text;
alter table public.subscriptions add column if not exists custom_price numeric(14,2);
create unique index if not exists subscriptions_external_id_unique on public.subscriptions(external_id) where external_id is not null;

create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  external_id text unique,
  kind text not null check (kind in ('invoice','act','contract','other')),
  title text not null,
  status text not null default 'draft',
  file_url text,
  amount numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.optiai_events (
  id uuid primary key default gen_random_uuid(),
  external_event_id text not null unique,
  event_type text not null,
  account_id text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','skipped')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  occurred_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists optiai_events_status_created_idx on public.optiai_events(status, created_at);

create table if not exists public.routines_workspace (
  id text primary key,
  state jsonb not null,
  version bigint not null default 1,
  updated_by uuid references public.crm_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.save_routines_state(
  p_state jsonb,
  p_expected_version bigint,
  p_actor_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version bigint;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'Routines state must be an object';
  end if;

  select version into current_version from public.routines_workspace where id = 'default' for update;
  if current_version is null then
    insert into public.routines_workspace (id, state, version, updated_by)
    values ('default', p_state, 1, p_actor_id);
    return 1;
  end if;

  if p_expected_version is distinct from current_version then
    raise exception using errcode = '40001', message = 'Routines state changed by another user';
  end if;

  update public.routines_workspace
  set state = p_state, version = version + 1, updated_by = p_actor_id, updated_at = now()
  where id = 'default'
  returning version into current_version;
  return current_version;
end;
$$;

revoke all on function public.save_routines_state(jsonb, bigint, uuid) from public, anon, authenticated;
grant execute on function public.save_routines_state(jsonb, bigint, uuid) to service_role;

alter table public.os_user_settings enable row level security;
alter table public.lead_os_profiles enable row level security;
alter table public.lead_source_events enable row level security;
alter table public.lead_activation_checks enable row level security;
alter table public.client_documents enable row level security;
alter table public.optiai_events enable row level security;
alter table public.routines_workspace enable row level security;

drop policy if exists "service role manages os settings" on public.os_user_settings;
drop policy if exists "users read own os settings" on public.os_user_settings;
drop policy if exists "service role manages lead profiles" on public.lead_os_profiles;
drop policy if exists "service role manages source events" on public.lead_source_events;
drop policy if exists "service role manages activation checks" on public.lead_activation_checks;
drop policy if exists "service role manages documents" on public.client_documents;
drop policy if exists "service role manages optiai events" on public.optiai_events;
drop policy if exists "service role manages routines" on public.routines_workspace;
create policy "service role manages os settings" on public.os_user_settings for all to service_role using (true) with check (true);
create policy "users read own os settings" on public.os_user_settings for select to authenticated using (user_id = public.current_crm_user_id() or public.current_crm_role() = 'Руководитель');
create policy "service role manages lead profiles" on public.lead_os_profiles for all to service_role using (true) with check (true);
create policy "service role manages source events" on public.lead_source_events for all to service_role using (true) with check (true);
create policy "service role manages activation checks" on public.lead_activation_checks for all to service_role using (true) with check (true);
create policy "service role manages documents" on public.client_documents for all to service_role using (true) with check (true);
create policy "service role manages optiai events" on public.optiai_events for all to service_role using (true) with check (true);
create policy "service role manages routines" on public.routines_workspace for all to service_role using (true) with check (true);

alter table public.leads drop constraint if exists refusal_required_on_stage_13;
update public.leads
set stage_order = case
  when stage_order = 0 then 0
  when stage_order between 1 and 6 then 1
  when stage_order = 7 and refusal_reason is null then 2
  when stage_order = 8 then 3
  when stage_order in (9, 10, 11) then 4
  when stage_order = 12 then 6
  else stage_order
end;

delete from public.pipeline_stages where stage_order > 6;
insert into public.pipeline_stages (stage_order, name, requires_refusal_reason, creates_callback_tasks) values
  (0, 'Новый лид', false, false),
  (1, 'Прогрев', false, true),
  (2, 'Планирует оплату', false, true),
  (3, 'Оплата и подключение', false, false),
  (4, 'Подключён', false, false),
  (5, 'Не продлил подписку', false, true),
  (6, 'Отказ', true, false)
on conflict (stage_order) do update set
  name = excluded.name,
  requires_refusal_reason = excluded.requires_refusal_reason,
  creates_callback_tasks = excluded.creates_callback_tasks;

alter table public.leads drop constraint if exists refusal_required_on_stage_7;
alter table public.leads add constraint refusal_required_on_stage_7
  check (stage_order <> 6 or refusal_reason is not null);

drop policy if exists "role based lead read" on public.leads;
create policy "role based lead read" on public.leads for select to authenticated using (
  public.current_crm_role() in ('Руководитель','РОП','Менеджер','Аккаунт-менеджер','Технический специалист')
);

notify pgrst, 'reload schema';
