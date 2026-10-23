create extension if not exists pgcrypto;

do $$ begin create type public.crm_role as enum ('Руководитель', 'РОП', 'Менеджер', 'Аккаунт-менеджер'); exception when duplicate_object then null; end $$;
do $$ begin create type public.user_status as enum ('active', 'disabled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_temperature as enum ('hot', 'warm', 'cold'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_status as enum ('sales', 'warmup', 'client', 'lost'); exception when duplicate_object then null; end $$;
do $$ begin create type public.task_priority as enum ('high', 'medium', 'low'); exception when duplicate_object then null; end $$;
do $$ begin create type public.activity_type as enum ('message', 'call', 'task', 'stage', 'payment', 'warmup', 'system'); exception when duplicate_object then null; end $$;
do $$ begin create type public.subscription_status as enum ('active', 'pending_payment', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_status as enum ('paid', 'pending', 'failed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.integration_status as enum ('connected', 'needs_setup', 'error'); exception when duplicate_object then null; end $$;

create table if not exists public.crm_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null unique,
  role public.crm_role not null,
  position text not null,
  status public.user_status not null default 'active',
  calls integer not null default 0,
  meetings integer not null default 0,
  revenue numeric(14,2) not null default 0,
  conversion numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tariffs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price numeric(14,2) not null check (price >= 0)
);

create table if not exists public.pipeline_stages (
  stage_order integer primary key,
  name text not null,
  requires_refusal_reason boolean not null default false,
  creates_callback_tasks boolean not null default false
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  site text,
  industry text,
  company_size text,
  region text,
  has_seo boolean,
  has_context boolean,
  has_marketer boolean,
  has_agency boolean,
  branded_queries integer,
  llm_visibility numeric(5,2),
  geo_potential text not null default 'Новый',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  position text,
  phone text,
  email text,
  telegram text,
  whatsapp text,
  max_handle text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  owner_id uuid references public.crm_users(id) on delete set null,
  tariff_id uuid references public.tariffs(id) on delete set null,
  stage_order integer not null references public.pipeline_stages(stage_order) default 0,
  status public.lead_status not null default 'sales',
  source_channel text not null,
  source_detail text,
  score integer not null default 0 check (score between 0 and 100),
  temperature public.lead_temperature not null default 'cold',
  pain text,
  current_promotion_channels text,
  budget text,
  next_step text,
  refusal_reason text,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refusal_required_on_stage_13 check (stage_order <> 12 or refusal_reason is not null)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  owner_id uuid references public.crm_users(id) on delete set null,
  title text not null,
  due_at date not null,
  priority public.task_priority not null default 'medium',
  status text not null default 'open' check (status in ('open', 'done')),
  automation_key text,
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type public.activity_type not null,
  title text not null,
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists public.call_records (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  owner_id uuid references public.crm_users(id) on delete set null,
  recording_url text,
  transcript text,
  summary text,
  objections text[] not null default '{}',
  next_steps text[] not null default '{}',
  interest integer not null default 0 check (interest between 0 and 100),
  deal_probability integer not null default 0 check (deal_probability between 0 and 100),
  manager_mistakes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tariff_id uuid not null references public.tariffs(id),
  started_at date not null,
  ends_at date not null,
  next_payment_at date not null,
  contract_months integer not null default 3,
  status public.subscription_status not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  amount numeric(14,2) not null check (amount >= 0),
  paid_at date,
  provider text not null default 'RoboKassa',
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.warmup_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.warmup_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.warmup_sequences(id) on delete cascade,
  day integer not null check (day >= 0),
  title text not null,
  message text not null,
  content_type text not null default 'Custom',
  sort_order integer not null default 0
);

create table if not exists public.warmup_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  sequence_id uuid not null references public.warmup_sequences(id) on delete cascade,
  assigned_by uuid references public.crm_users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
  created_at timestamptz not null default now()
);

create table if not exists public.integrations (
  id text primary key,
  name text not null,
  description text,
  status public.integration_status not null default 'needs_setup',
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists leads_owner_idx on public.leads(owner_id);
create index if not exists leads_stage_idx on public.leads(stage_order);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists tasks_owner_due_idx on public.tasks(owner_id, due_at);
create index if not exists activities_lead_created_idx on public.activities(lead_id, created_at desc);
create index if not exists calls_lead_created_idx on public.call_records(lead_id, created_at desc);
create index if not exists subscriptions_next_payment_idx on public.subscriptions(next_payment_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_users_updated_at on public.crm_users;
create trigger crm_users_updated_at before update on public.crm_users for each row execute function public.set_updated_at();
drop trigger if exists companies_updated_at on public.companies;
create trigger companies_updated_at before update on public.companies for each row execute function public.set_updated_at();
drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at before update on public.leads for each row execute function public.set_updated_at();

create or replace function public.current_crm_role()
returns text
language sql stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'crm_role', '');
$$;

create or replace function public.current_crm_user_id()
returns uuid
language sql stable
as $$
  select id from public.crm_users where auth_user_id = auth.uid() limit 1;
$$;

alter table public.crm_users enable row level security;
alter table public.tariffs enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;
alter table public.call_records enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.warmup_sequences enable row level security;
alter table public.warmup_steps enable row level security;
alter table public.warmup_assignments enable row level security;
alter table public.integrations enable row level security;
alter table public.crm_app_state enable row level security;

drop policy if exists "crm users can read active users" on public.crm_users;
create policy "crm users can read active users" on public.crm_users for select to authenticated using (status = 'active');
drop policy if exists "owner manages users" on public.crm_users;
create policy "owner manages users" on public.crm_users for all to authenticated using (public.current_crm_role() = 'Руководитель') with check (public.current_crm_role() = 'Руководитель');

drop policy if exists "authenticated read dictionaries" on public.tariffs;
create policy "authenticated read dictionaries" on public.tariffs for select to authenticated using (true);
drop policy if exists "authenticated read pipeline" on public.pipeline_stages;
create policy "authenticated read pipeline" on public.pipeline_stages for select to authenticated using (true);
drop policy if exists "authenticated read warmup sequences" on public.warmup_sequences;
create policy "authenticated read warmup sequences" on public.warmup_sequences for select to authenticated using (true);
drop policy if exists "authenticated read warmup steps" on public.warmup_steps;
create policy "authenticated read warmup steps" on public.warmup_steps for select to authenticated using (true);
drop policy if exists "owners manage integrations" on public.integrations;
create policy "owners manage integrations" on public.integrations for all to authenticated using (public.current_crm_role() = 'Руководитель') with check (public.current_crm_role() = 'Руководитель');
drop policy if exists "service role manages crm app state" on public.crm_app_state;
create policy "service role manages crm app state" on public.crm_app_state for all to service_role using (true) with check (true);

drop policy if exists "company access by linked lead" on public.companies;
create policy "company access by linked lead" on public.companies for select to authenticated using (
  public.current_crm_role() in ('Руководитель', 'РОП')
  or exists (
    select 1 from public.leads l
    where l.company_id = companies.id
      and (
        l.owner_id = public.current_crm_user_id()
        or (public.current_crm_role() = 'Аккаунт-менеджер' and l.status = 'client')
      )
  )
);
drop policy if exists "owners rops manage companies" on public.companies;
create policy "owners rops manage companies" on public.companies for all to authenticated using (public.current_crm_role() in ('Руководитель', 'РОП')) with check (public.current_crm_role() in ('Руководитель', 'РОП'));

drop policy if exists "contacts access by linked lead" on public.contacts;
create policy "contacts access by linked lead" on public.contacts for select to authenticated using (
  public.current_crm_role() in ('Руководитель', 'РОП')
  or exists (
    select 1 from public.leads l
    where l.company_id = contacts.company_id
      and (
        l.owner_id = public.current_crm_user_id()
        or (public.current_crm_role() = 'Аккаунт-менеджер' and l.status = 'client')
      )
  )
);
drop policy if exists "owners rops manage contacts" on public.contacts;
create policy "owners rops manage contacts" on public.contacts for all to authenticated using (public.current_crm_role() in ('Руководитель', 'РОП')) with check (public.current_crm_role() in ('Руководитель', 'РОП'));

drop policy if exists "role based lead read" on public.leads;
create policy "role based lead read" on public.leads for select to authenticated using (
  public.current_crm_role() in ('Руководитель', 'РОП')
  or owner_id = public.current_crm_user_id()
  or (public.current_crm_role() = 'Аккаунт-менеджер' and status = 'client')
);
drop policy if exists "sales can update own leads" on public.leads;
create policy "sales can update own leads" on public.leads for update to authenticated using (
  public.current_crm_role() in ('Руководитель', 'РОП')
  or owner_id = public.current_crm_user_id()
) with check (
  public.current_crm_role() in ('Руководитель', 'РОП')
  or owner_id = public.current_crm_user_id()
);
drop policy if exists "owners rops insert leads" on public.leads;
create policy "owners rops insert leads" on public.leads for insert to authenticated with check (public.current_crm_role() in ('Руководитель', 'РОП', 'Менеджер'));

drop policy if exists "lead child read" on public.tasks;
create policy "lead child read" on public.tasks for select to authenticated using (exists (select 1 from public.leads l where l.id = tasks.lead_id));
drop policy if exists "lead child manage tasks" on public.tasks;
create policy "lead child manage tasks" on public.tasks for all to authenticated using (public.current_crm_role() in ('Руководитель', 'РОП') or owner_id = public.current_crm_user_id()) with check (public.current_crm_role() in ('Руководитель', 'РОП') or owner_id = public.current_crm_user_id());
drop policy if exists "lead child activities" on public.activities;
create policy "lead child activities" on public.activities for all to authenticated using (exists (select 1 from public.leads l where l.id = activities.lead_id)) with check (exists (select 1 from public.leads l where l.id = activities.lead_id));
drop policy if exists "lead child calls" on public.call_records;
create policy "lead child calls" on public.call_records for all to authenticated using (exists (select 1 from public.leads l where l.id = call_records.lead_id)) with check (exists (select 1 from public.leads l where l.id = call_records.lead_id));
drop policy if exists "lead child subscriptions" on public.subscriptions;
create policy "lead child subscriptions" on public.subscriptions for all to authenticated using (exists (select 1 from public.leads l where l.id = subscriptions.lead_id)) with check (exists (select 1 from public.leads l where l.id = subscriptions.lead_id));
drop policy if exists "lead child payments" on public.payments;
create policy "lead child payments" on public.payments for all to authenticated using (exists (select 1 from public.leads l where l.id = payments.lead_id)) with check (exists (select 1 from public.leads l where l.id = payments.lead_id));
drop policy if exists "lead child warmup assignments" on public.warmup_assignments;
create policy "lead child warmup assignments" on public.warmup_assignments for all to authenticated using (exists (select 1 from public.leads l where l.id = warmup_assignments.lead_id)) with check (exists (select 1 from public.leads l where l.id = warmup_assignments.lead_id));
