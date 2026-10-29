create table if not exists public.content_module_installations (
  id uuid primary key default gen_random_uuid(),
  slot text not null unique default 'default' check (slot = 'default'),
  name text not null,
  version text not null default '1.0.0',
  entry_path text not null default 'index.html',
  storage_prefix text not null unique,
  access_token text not null unique,
  object_paths text[] not null default '{}',
  file_count integer not null default 0 check (file_count >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  installed_by uuid references public.crm_users(id) on delete set null,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.content_module_installations enable row level security;

drop policy if exists "service role manages content module" on public.content_module_installations;
create policy "service role manages content module"
  on public.content_module_installations
  for all
  to service_role
  using (true)
  with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-modules', 'content-modules', false, 41943040, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
