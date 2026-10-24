alter table public.messenger_connections
  add column if not exists external_account_username text;

alter table public.messenger_conversations
  add column if not exists bot_external_account_id text,
  add column if not exists needs_reconnect boolean not null default false;

update public.messenger_conversations as conversation
set bot_external_account_id = connection.external_account_id
from public.messenger_connections as connection
where conversation.connection_id = connection.id
  and conversation.channel = 'telegram'
  and conversation.bot_external_account_id is null
  and connection.external_account_id is not null;

create index if not exists messenger_conversations_reconnect_idx
  on public.messenger_conversations (channel, needs_reconnect)
  where needs_reconnect = true;

notify pgrst, 'reload schema';
