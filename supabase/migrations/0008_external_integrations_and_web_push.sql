alter table public.messenger_connections drop constraint if exists messenger_connections_channel_check;
alter table public.messenger_connections
  add constraint messenger_connections_channel_check
  check (channel in ('telegram', 'whatsapp', 'max', 'instagram', 'avito'));

alter table public.messenger_conversations drop constraint if exists messenger_conversations_channel_check;
alter table public.messenger_conversations
  add constraint messenger_conversations_channel_check
  check (channel in ('telegram', 'whatsapp', 'max', 'instagram', 'avito'));

alter table public.messenger_messages drop constraint if exists messenger_messages_channel_check;
alter table public.messenger_messages
  add constraint messenger_messages_channel_check
  check (channel in ('telegram', 'whatsapp', 'max', 'instagram', 'avito'));

alter table public.messenger_webhook_events drop constraint if exists messenger_webhook_events_provider_check;
alter table public.messenger_webhook_events
  add constraint messenger_webhook_events_provider_check
  check (provider in ('telegram', 'whatsapp', 'max', 'instagram', 'avito'));

alter table public.crm_notifications drop constraint if exists crm_notifications_type_check;
alter table public.crm_notifications
  add constraint crm_notifications_type_check
  check (type in ('task_due', 'callback', 'warmup', 'renewal', 'automation', 'system', 'message'));

insert into public.messenger_connections (id, channel, name, status) values
  ('instagram', 'instagram', 'Instagram Messaging API', 'needs_setup'),
  ('avito', 'avito', 'Avito Messenger API', 'needs_setup')
on conflict (id) do update set name = excluded.name;

create table if not exists public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  integration_id text not null,
  initiated_by uuid references public.crm_users(id) on delete set null,
  direction text not null check (direction in ('check', 'import', 'export', 'bidirectional', 'webhook')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  records_read integer not null default 0 check (records_read >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  details jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists integration_sync_runs_integration_started_idx
  on public.integration_sync_runs(integration_id, started_at desc);

create table if not exists public.integration_export_events (
  integration_id text not null,
  event_key text not null,
  external_id text,
  exported_at timestamptz not null default now(),
  primary key (integration_id, event_key)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.integration_sync_runs enable row level security;
alter table public.integration_export_events enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "management reads integration sync runs" on public.integration_sync_runs;
drop policy if exists "service role manages integration sync runs" on public.integration_sync_runs;
create policy "management reads integration sync runs" on public.integration_sync_runs
  for select to authenticated
  using (public.current_crm_role() in ('Руководитель', 'РОП'));
create policy "service role manages integration sync runs" on public.integration_sync_runs
  for all to service_role using (true) with check (true);

drop policy if exists "management reads integration export events" on public.integration_export_events;
drop policy if exists "service role manages integration export events" on public.integration_export_events;
create policy "management reads integration export events" on public.integration_export_events
  for select to authenticated
  using (public.current_crm_role() in ('Руководитель', 'РОП'));
create policy "service role manages integration export events" on public.integration_export_events
  for all to service_role using (true) with check (true);

drop policy if exists "users read own push subscriptions" on public.push_subscriptions;
drop policy if exists "service role manages push subscriptions" on public.push_subscriptions;
create policy "users read own push subscriptions" on public.push_subscriptions
  for select to authenticated
  using (user_id = public.current_crm_user_id());
create policy "service role manages push subscriptions" on public.push_subscriptions
  for all to service_role using (true) with check (true);

notify pgrst, 'reload schema';
