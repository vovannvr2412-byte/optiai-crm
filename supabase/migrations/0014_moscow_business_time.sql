alter table public.warmup_assignments
  alter column started_at set default ((now() at time zone 'Europe/Moscow')::date);

comment on column public.warmup_assignments.started_at is
  'Business date in Europe/Moscow. Exact event timestamps remain timestamptz in UTC.';
