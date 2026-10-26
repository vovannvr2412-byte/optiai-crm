insert into public.integrations (id, name, description, status)
values ('ai', 'AI-анализ', 'Разбор звонков через OpenAI, Claude или Gemini', 'needs_setup')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description;
