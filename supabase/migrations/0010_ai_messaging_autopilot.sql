alter table public.messenger_conversations
  add column if not exists ai_mode text not null default 'auto';

alter table public.messenger_conversations
  drop constraint if exists messenger_conversations_ai_mode_check;

alter table public.messenger_conversations
  add constraint messenger_conversations_ai_mode_check
  check (ai_mode in ('auto', 'paused'));

create index if not exists messenger_conversations_ai_mode_idx
  on public.messenger_conversations(ai_mode, channel);

update public.integrations
set
  name = 'AI-ассистент',
  description = 'Анализ звонков, автоматические ответы и персонализация прогревов'
where id = 'ai';

notify pgrst, 'reload schema';
