alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('open', 'done', 'cancelled'));

alter table public.warmup_assignments add column if not exists started_at date;
alter table public.warmup_assignments add column if not exists completed_at timestamptz;

update public.warmup_assignments
set started_at = created_at::date
where started_at is null;

alter table public.warmup_assignments alter column started_at set default current_date;
alter table public.warmup_assignments alter column started_at set not null;

with ranked_assignments as (
  select id, row_number() over (partition by lead_id order by created_at desc, id desc) as position
  from public.warmup_assignments
  where status = 'active'
)
update public.warmup_assignments as assignment
set status = 'paused'
from ranked_assignments
where assignment.id = ranked_assignments.id
  and ranked_assignments.position > 1;

create unique index if not exists warmup_assignments_one_active_per_lead
  on public.warmup_assignments(lead_id)
  where status = 'active';

create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  type text not null check (type in ('task_due', 'callback', 'warmup', 'renewal', 'automation', 'system')),
  title text not null,
  body text not null default '',
  event_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists crm_notifications_user_unread_idx
  on public.crm_notifications(user_id, created_at desc)
  where read_at is null;

create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  kind text not null,
  lead_id uuid references public.leads(id) on delete cascade,
  user_id uuid references public.crm_users(id) on delete set null,
  task_id uuid references public.tasks(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  scheduled_for timestamptz not null,
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error text,
  locked_at timestamptz,
  next_attempt_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_events_status_schedule_idx
  on public.automation_events(status, scheduled_for, next_attempt_at);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'vercel_cron',
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists automation_runs_started_idx
  on public.automation_runs(started_at desc);

create or replace function public.claim_automation_event(
  p_event_key text,
  p_kind text,
  p_scheduled_for timestamptz,
  p_lead_id uuid default null,
  p_user_id uuid default null,
  p_task_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns table(id uuid, attempts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.automation_events (
    event_key, kind, lead_id, user_id, task_id, scheduled_for, payload
  ) values (
    p_event_key, p_kind, p_lead_id, p_user_id, p_task_id, p_scheduled_for, coalesce(p_payload, '{}'::jsonb)
  ) on conflict (event_key) do nothing;

  return query
  update public.automation_events as event
  set
    status = 'processing',
    attempts = event.attempts + 1,
    error = null,
    locked_at = now(),
    updated_at = now()
  where event.event_key = p_event_key
    and event.scheduled_for <= now()
    and (
      event.status = 'pending'
      or (event.status = 'failed' and (event.next_attempt_at is null or event.next_attempt_at <= now()))
      or (event.status = 'processing' and event.locked_at < now() - interval '20 minutes')
    )
  returning event.id, event.attempts;
end;
$$;

revoke all on function public.claim_automation_event(text, text, timestamptz, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_automation_event(text, text, timestamptz, uuid, uuid, uuid, jsonb) to service_role;

alter table public.crm_notifications enable row level security;
alter table public.automation_events enable row level security;
alter table public.automation_runs enable row level security;

drop policy if exists "users read own notifications" on public.crm_notifications;
drop policy if exists "users update own notifications" on public.crm_notifications;
drop policy if exists "service role manages notifications" on public.crm_notifications;
create policy "users read own notifications" on public.crm_notifications
  for select to authenticated
  using (user_id = public.current_crm_user_id());
create policy "users update own notifications" on public.crm_notifications
  for update to authenticated
  using (user_id = public.current_crm_user_id())
  with check (user_id = public.current_crm_user_id());
create policy "service role manages notifications" on public.crm_notifications
  for all to service_role using (true) with check (true);

drop policy if exists "management reads automation events" on public.automation_events;
drop policy if exists "service role manages automation events" on public.automation_events;
create policy "management reads automation events" on public.automation_events
  for select to authenticated
  using (public.current_crm_role() in ('Руководитель', 'РОП'));
create policy "service role manages automation events" on public.automation_events
  for all to service_role using (true) with check (true);

drop policy if exists "management reads automation runs" on public.automation_runs;
drop policy if exists "service role manages automation runs" on public.automation_runs;
create policy "management reads automation runs" on public.automation_runs
  for select to authenticated
  using (public.current_crm_role() in ('Руководитель', 'РОП'));
create policy "service role manages automation runs" on public.automation_runs
  for all to service_role using (true) with check (true);

notify pgrst, 'reload schema';
