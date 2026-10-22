create table if not exists public.messenger_connections (
  id text primary key,
  channel text not null unique check (channel in ('telegram', 'whatsapp', 'max')),
  name text not null,
  external_account_id text,
  status text not null default 'needs_setup' check (status in ('not_configured', 'needs_setup', 'connected', 'error')),
  last_sync_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  connection_id text not null,
  channel text not null check (channel in ('telegram', 'whatsapp', 'max')),
  external_conversation_id text not null,
  external_contact_id text not null,
  contact_name text not null,
  avatar_url text,
  phone text,
  username text,
  lead_id text,
  owner_id text,
  last_message_text text not null default '',
  last_message_at timestamptz not null default now(),
  unread_count integer not null default 0 check (unread_count >= 0),
  status text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_conversation_id)
);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  connection_id text not null,
  channel text not null check (channel in ('telegram', 'whatsapp', 'max')),
  external_message_id text,
  idempotency_key text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_name text not null,
  sender_external_id text,
  text text not null,
  sent_at timestamptz not null default now(),
  status text not null check (status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
  content_type text not null default 'text' check (content_type in ('text', 'image', 'video', 'audio', 'file', 'location', 'unknown')),
  attachments jsonb not null default '[]'::jsonb,
  error_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.messenger_webhook_events (
  provider text not null check (provider in ('telegram', 'whatsapp', 'max')),
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create unique index if not exists messenger_external_message_unique
  on public.messenger_messages(connection_id, channel, external_message_id)
  where external_message_id is not null;
create index if not exists messenger_conversations_last_message_idx on public.messenger_conversations(last_message_at desc);
create index if not exists messenger_conversations_owner_idx on public.messenger_conversations(owner_id);
create index if not exists messenger_conversations_lead_idx on public.messenger_conversations(lead_id);
create index if not exists messenger_messages_history_idx on public.messenger_messages(conversation_id, sent_at desc);

drop trigger if exists messenger_connections_updated_at on public.messenger_connections;
create trigger messenger_connections_updated_at before update on public.messenger_connections
for each row execute function public.set_updated_at();
drop trigger if exists messenger_conversations_updated_at on public.messenger_conversations;
create trigger messenger_conversations_updated_at before update on public.messenger_conversations
for each row execute function public.set_updated_at();

alter table public.messenger_connections enable row level security;
alter table public.messenger_conversations enable row level security;
alter table public.messenger_messages enable row level security;
alter table public.messenger_webhook_events enable row level security;

drop policy if exists "service role manages messenger connections" on public.messenger_connections;
create policy "service role manages messenger connections" on public.messenger_connections
for all to service_role using (true) with check (true);
drop policy if exists "service role manages messenger conversations" on public.messenger_conversations;
create policy "service role manages messenger conversations" on public.messenger_conversations
for all to service_role using (true) with check (true);
drop policy if exists "service role manages messenger messages" on public.messenger_messages;
create policy "service role manages messenger messages" on public.messenger_messages
for all to service_role using (true) with check (true);
drop policy if exists "service role manages messenger webhook events" on public.messenger_webhook_events;
create policy "service role manages messenger webhook events" on public.messenger_webhook_events
for all to service_role using (true) with check (true);

insert into public.messenger_connections (id, channel, name, status) values
  ('telegram', 'telegram', 'Telegram Bot API', 'needs_setup'),
  ('whatsapp', 'whatsapp', 'WhatsApp Business Cloud API', 'needs_setup'),
  ('max', 'max', 'MAX Bot API', 'needs_setup')
on conflict (id) do nothing;
