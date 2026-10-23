alter table public.warmup_steps add column if not exists attachment_url text;
alter table public.warmup_steps add column if not exists attachment_type text check (attachment_type in ('image', 'video'));
alter table public.warmup_steps add column if not exists attachment_name text;
alter table public.integrations add column if not exists config jsonb not null default '{}'::jsonb;

create unique index if not exists crm_users_auth_user_id_unique
  on public.crm_users(auth_user_id)
  where auth_user_id is not null;

create or replace function public.save_crm_state_normalized(p_state jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'CRM state must be a JSON object';
  end if;

  insert into public.crm_users (
    id, full_name, email, role, position, status, calls, meetings, revenue, conversion, created_at
  )
  select
    (item->>'id')::uuid,
    item->>'fullName',
    lower(item->>'email'),
    (item->>'role')::public.crm_role,
    item->>'position',
    (item->>'status')::public.user_status,
    coalesce((item->>'calls')::integer, 0),
    coalesce((item->>'meetings')::integer, 0),
    coalesce((item->>'revenue')::numeric, 0),
    coalesce((item->>'conversion')::numeric, 0),
    coalesce((item->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_state->'users', '[]'::jsonb)) item
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    position = excluded.position,
    status = excluded.status,
    calls = excluded.calls,
    meetings = excluded.meetings,
    revenue = excluded.revenue,
    conversion = excluded.conversion;

  insert into public.tariffs (id, code, name, price)
  select
    (item->>'id')::uuid,
    case item->>'name'
      when 'SEO + GEO Start' then 'start'
      when 'SEO + GEO Growth' then 'growth'
      when 'SEO + GEO Dominance' then 'dominance'
      else 'tariff-' || replace(item->>'id', '-', '')
    end,
    item->>'name',
    coalesce((item->>'price')::numeric, 0)
  from jsonb_array_elements(coalesce(p_state->'tariffs', '[]'::jsonb)) item
  on conflict (id) do update set
    name = excluded.name,
    price = excluded.price;

  insert into public.warmup_sequences (id, name, description, active)
  select
    (item->>'id')::uuid,
    item->>'name',
    coalesce(item->>'description', ''),
    coalesce((item->>'active')::boolean, true)
  from jsonb_array_elements(coalesce(p_state->'warmupSequences', '[]'::jsonb)) item
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    active = excluded.active;

  insert into public.companies (
    id, name, site, industry, company_size, region, has_seo, has_context, has_marketer,
    has_agency, branded_queries, llm_visibility, geo_potential, created_at
  )
  select
    (item->>'id')::uuid,
    item->>'companyName',
    nullif(item->>'site', ''),
    nullif(item->>'industry', ''),
    nullif(item->>'companySize', ''),
    nullif(item->>'region', ''),
    (item->>'hasSeo')::boolean,
    (item->>'hasContext')::boolean,
    (item->>'hasMarketer')::boolean,
    (item->>'hasAgency')::boolean,
    (item->>'brandedQueries')::integer,
    (item->>'llmVisibility')::numeric,
    coalesce(nullif(item->>'geoPotential', ''), 'Новый'),
    coalesce((item->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) item
  on conflict (id) do update set
    name = excluded.name,
    site = excluded.site,
    industry = excluded.industry,
    company_size = excluded.company_size,
    region = excluded.region,
    has_seo = excluded.has_seo,
    has_context = excluded.has_context,
    has_marketer = excluded.has_marketer,
    has_agency = excluded.has_agency,
    branded_queries = excluded.branded_queries,
    llm_visibility = excluded.llm_visibility,
    geo_potential = excluded.geo_potential;

  insert into public.contacts (
    id, company_id, full_name, position, phone, email, telegram, whatsapp, max_handle, created_at
  )
  select
    (item->>'id')::uuid,
    (item->>'id')::uuid,
    item->>'contactName',
    nullif(item->>'contactRole', ''),
    nullif(item->>'phone', ''),
    nullif(item->>'email', ''),
    nullif(item->>'telegram', ''),
    nullif(item->>'whatsapp', ''),
    nullif(item->>'max', ''),
    coalesce((item->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) item
  on conflict (id) do update set
    full_name = excluded.full_name,
    position = excluded.position,
    phone = excluded.phone,
    email = excluded.email,
    telegram = excluded.telegram,
    whatsapp = excluded.whatsapp,
    max_handle = excluded.max_handle;

  insert into public.leads (
    id, company_id, primary_contact_id, owner_id, tariff_id, stage_order, status,
    source_channel, source_detail, score, temperature, pain, current_promotion_channels,
    budget, next_step, refusal_reason, last_contact_at, created_at
  )
  select
    (item->>'id')::uuid,
    (item->>'id')::uuid,
    (item->>'id')::uuid,
    nullif(item->>'ownerId', '')::uuid,
    nullif(item->>'tariffId', '')::uuid,
    coalesce((item->>'stage')::integer, 0),
    coalesce(item->>'status', 'sales')::public.lead_status,
    coalesce(item->>'sourceChannel', 'CRM'),
    nullif(item->>'sourceDetail', ''),
    coalesce((item->>'score')::integer, 0),
    coalesce(item->>'temperature', 'cold')::public.lead_temperature,
    nullif(item->>'pain', ''),
    nullif(item->>'currentPromotionChannels', ''),
    nullif(item->>'budget', ''),
    nullif(item->>'nextStep', ''),
    case
      when coalesce((item->>'stage')::integer, 0) = 12
        then coalesce(nullif(item->>'refusalReason', ''), 'Причина не была указана до переноса')
      else nullif(item->>'refusalReason', '')
    end,
    nullif(item->>'lastContactAt', '')::timestamptz,
    coalesce((item->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) item
  on conflict (id) do update set
    company_id = excluded.company_id,
    primary_contact_id = excluded.primary_contact_id,
    owner_id = excluded.owner_id,
    tariff_id = excluded.tariff_id,
    stage_order = excluded.stage_order,
    status = excluded.status,
    source_channel = excluded.source_channel,
    source_detail = excluded.source_detail,
    score = excluded.score,
    temperature = excluded.temperature,
    pain = excluded.pain,
    current_promotion_channels = excluded.current_promotion_channels,
    budget = excluded.budget,
    next_step = excluded.next_step,
    refusal_reason = excluded.refusal_reason,
    last_contact_at = excluded.last_contact_at;

  insert into public.tasks (id, lead_id, owner_id, title, due_at, priority, status, automation_key)
  select
    (item->>'id')::uuid,
    (item->>'leadId')::uuid,
    nullif(item->>'ownerId', '')::uuid,
    item->>'title',
    (item->>'dueAt')::date,
    coalesce(item->>'priority', 'medium')::public.task_priority,
    coalesce(item->>'status', 'open'),
    nullif(item->>'automationKey', '')
  from jsonb_array_elements(coalesce(p_state->'tasks', '[]'::jsonb)) item
  on conflict (id) do update set
    lead_id = excluded.lead_id,
    owner_id = excluded.owner_id,
    title = excluded.title,
    due_at = excluded.due_at,
    priority = excluded.priority,
    status = excluded.status,
    automation_key = excluded.automation_key;

  insert into public.activities (id, lead_id, type, title, detail, created_at)
  select
    (item->>'id')::uuid,
    (item->>'leadId')::uuid,
    (item->>'type')::public.activity_type,
    item->>'title',
    nullif(item->>'detail', ''),
    coalesce((item->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_state->'activities', '[]'::jsonb)) item
  on conflict (id) do update set
    lead_id = excluded.lead_id,
    type = excluded.type,
    title = excluded.title,
    detail = excluded.detail;

  insert into public.call_records (
    id, lead_id, owner_id, recording_url, transcript, summary, objections, next_steps,
    interest, deal_probability, manager_mistakes, created_at
  )
  select
    (item->>'id')::uuid,
    (item->>'leadId')::uuid,
    nullif(item->>'ownerId', '')::uuid,
    nullif(item->>'recordingUrl', ''),
    nullif(item->>'transcript', ''),
    nullif(item->>'summary', ''),
    array(select jsonb_array_elements_text(coalesce(item->'objections', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(item->'nextSteps', '[]'::jsonb))),
    coalesce((item->>'interest')::integer, 0),
    coalesce((item->>'dealProbability')::integer, 0),
    array(select jsonb_array_elements_text(coalesce(item->'managerMistakes', '[]'::jsonb))),
    coalesce((item->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_state->'callRecords', '[]'::jsonb)) item
  on conflict (id) do update set
    lead_id = excluded.lead_id,
    owner_id = excluded.owner_id,
    recording_url = excluded.recording_url,
    transcript = excluded.transcript,
    summary = excluded.summary,
    objections = excluded.objections,
    next_steps = excluded.next_steps,
    interest = excluded.interest,
    deal_probability = excluded.deal_probability,
    manager_mistakes = excluded.manager_mistakes;

  insert into public.subscriptions (
    id, lead_id, tariff_id, started_at, ends_at, next_payment_at, contract_months, status
  )
  select
    (item->>'id')::uuid,
    (item->>'leadId')::uuid,
    (item->>'tariffId')::uuid,
    (item->>'startedAt')::date,
    (item->>'endsAt')::date,
    (item->>'nextPaymentAt')::date,
    coalesce((item->>'contractMonths')::integer, 3),
    coalesce(item->>'status', 'active')::public.subscription_status
  from jsonb_array_elements(coalesce(p_state->'subscriptions', '[]'::jsonb)) item
  on conflict (id) do update set
    lead_id = excluded.lead_id,
    tariff_id = excluded.tariff_id,
    started_at = excluded.started_at,
    ends_at = excluded.ends_at,
    next_payment_at = excluded.next_payment_at,
    contract_months = excluded.contract_months,
    status = excluded.status;

  insert into public.payments (id, lead_id, amount, paid_at, provider, status)
  select
    (item->>'id')::uuid,
    (item->>'leadId')::uuid,
    coalesce((item->>'amount')::numeric, 0),
    nullif(item->>'paidAt', '')::date,
    coalesce(item->>'provider', 'manual'),
    coalesce(item->>'status', 'pending')::public.payment_status
  from jsonb_array_elements(coalesce(p_state->'payments', '[]'::jsonb)) item
  on conflict (id) do update set
    lead_id = excluded.lead_id,
    amount = excluded.amount,
    paid_at = excluded.paid_at,
    provider = excluded.provider,
    status = excluded.status;

  insert into public.warmup_steps (
    id, sequence_id, day, title, message, content_type, sort_order,
    attachment_url, attachment_type, attachment_name
  )
  select
    (step->>'id')::uuid,
    (sequence->>'id')::uuid,
    coalesce((step->>'day')::integer, 0),
    step->>'title',
    step->>'message',
    coalesce(step->>'contentType', 'Custom'),
    (row_number() over (partition by sequence->>'id' order by (step->>'day')::integer, step->>'title'))::integer,
    nullif(step->>'attachmentUrl', ''),
    nullif(step->>'attachmentType', ''),
    nullif(step->>'attachmentName', '')
  from jsonb_array_elements(coalesce(p_state->'warmupSequences', '[]'::jsonb)) sequence
  cross join lateral jsonb_array_elements(coalesce(sequence->'steps', '[]'::jsonb)) step
  on conflict (id) do update set
    sequence_id = excluded.sequence_id,
    day = excluded.day,
    title = excluded.title,
    message = excluded.message,
    content_type = excluded.content_type,
    sort_order = excluded.sort_order,
    attachment_url = excluded.attachment_url,
    attachment_type = excluded.attachment_type,
    attachment_name = excluded.attachment_name;

  insert into public.integrations (id, name, description, status, config, updated_at)
  select
    item->>'id',
    item->>'name',
    nullif(item->>'description', ''),
    coalesce(item->>'status', 'needs_setup')::public.integration_status,
    coalesce(item->'config', '{}'::jsonb),
    coalesce((item->>'updatedAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_state->'integrations', '[]'::jsonb)) item
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    config = excluded.config,
    updated_at = excluded.updated_at;

  delete from public.tasks as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'tasks', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.activities as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'activities', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.call_records as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'callRecords', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.subscriptions as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'subscriptions', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.payments as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'payments', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.warmup_steps as target where not exists (
    select 1
    from jsonb_array_elements(coalesce(p_state->'warmupSequences', '[]'::jsonb)) sequence
    cross join lateral jsonb_array_elements(coalesce(sequence->'steps', '[]'::jsonb)) step
    where (step->>'id')::uuid = target.id
  );
  delete from public.leads as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.contacts as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.companies as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.warmup_sequences as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'warmupSequences', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
  delete from public.crm_users as target where not exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'users', '[]'::jsonb)) item
    where (item->>'id')::uuid = target.id
  );
end;
$$;

create or replace function public.get_crm_state_normalized()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text, 'fullName', full_name, 'email', email, 'role', role::text,
        'position', position, 'status', status::text, 'calls', calls, 'meetings', meetings,
        'revenue', revenue, 'conversion', conversion, 'createdAt', created_at
      ) order by created_at)
      from public.crm_users
    ), '[]'::jsonb),
    'tariffs', coalesce((
      select jsonb_agg(jsonb_build_object('id', id::text, 'name', name, 'price', price) order by price)
      from public.tariffs
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lead.id::text,
        'companyName', company.name,
        'site', coalesce(company.site, ''),
        'industry', coalesce(company.industry, ''),
        'companySize', coalesce(company.company_size, ''),
        'region', coalesce(company.region, ''),
        'contactName', contact.full_name,
        'contactRole', coalesce(contact.position, ''),
        'phone', coalesce(contact.phone, ''),
        'email', coalesce(contact.email, ''),
        'telegram', coalesce(contact.telegram, ''),
        'whatsapp', coalesce(contact.whatsapp, ''),
        'max', coalesce(contact.max_handle, ''),
        'hasSeo', company.has_seo,
        'hasContext', company.has_context,
        'hasMarketer', company.has_marketer,
        'hasAgency', company.has_agency,
        'brandedQueries', company.branded_queries,
        'llmVisibility', company.llm_visibility,
        'geoPotential', company.geo_potential,
        'stage', lead.stage_order,
        'status', lead.status::text,
        'sourceChannel', lead.source_channel,
        'sourceDetail', coalesce(lead.source_detail, ''),
        'ownerId', coalesce(lead.owner_id::text, ''),
        'score', lead.score,
        'temperature', lead.temperature::text,
        'pain', coalesce(lead.pain, ''),
        'currentPromotionChannels', coalesce(lead.current_promotion_channels, ''),
        'budget', coalesce(lead.budget, ''),
        'nextStep', coalesce(lead.next_step, ''),
        'refusalReason', lead.refusal_reason,
        'lastContactAt', lead.last_contact_at,
        'createdAt', lead.created_at,
        'tariffId', lead.tariff_id::text
      ) order by lead.created_at desc)
      from public.leads lead
      join public.companies company on company.id = lead.company_id
      join public.contacts contact on contact.id = lead.primary_contact_id
    ), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text, 'leadId', lead_id::text, 'tariffId', tariff_id::text,
        'startedAt', started_at, 'endsAt', ends_at, 'nextPaymentAt', next_payment_at,
        'contractMonths', contract_months, 'status', status::text
      ) order by created_at desc)
      from public.subscriptions
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text, 'leadId', lead_id::text, 'amount', amount, 'paidAt', paid_at,
        'provider', provider, 'status', status::text
      ) order by created_at desc)
      from public.payments
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text, 'leadId', lead_id::text, 'ownerId', coalesce(owner_id::text, ''),
        'title', title, 'dueAt', due_at, 'priority', priority::text, 'status', status,
        'automationKey', automation_key
      ) order by due_at, created_at)
      from public.tasks
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text, 'leadId', lead_id::text, 'type', type::text, 'title', title,
        'detail', coalesce(detail, ''), 'createdAt', created_at
      ) order by created_at desc)
      from public.activities
    ), '[]'::jsonb),
    'callRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text, 'leadId', lead_id::text, 'ownerId', coalesce(owner_id::text, ''),
        'recordingUrl', coalesce(recording_url, ''), 'transcript', coalesce(transcript, ''),
        'summary', coalesce(summary, ''), 'objections', to_jsonb(objections),
        'nextSteps', to_jsonb(next_steps), 'interest', interest,
        'dealProbability', deal_probability, 'managerMistakes', to_jsonb(manager_mistakes),
        'createdAt', created_at
      ) order by created_at desc)
      from public.call_records
    ), '[]'::jsonb),
    'warmupSequences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sequence.id::text,
        'name', sequence.name,
        'description', coalesce(sequence.description, ''),
        'active', sequence.active,
        'steps', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', step.id::text,
            'day', step.day,
            'title', step.title,
            'message', step.message,
            'contentType', step.content_type,
            'attachmentUrl', step.attachment_url,
            'attachmentType', step.attachment_type,
            'attachmentName', step.attachment_name
          )) order by step.day, step.sort_order, step.title)
          from public.warmup_steps step
          where step.sequence_id = sequence.id
        ), '[]'::jsonb)
      ) order by sequence.created_at)
      from public.warmup_sequences sequence
    ), '[]'::jsonb),
    'integrations', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'name', name, 'description', coalesce(description, ''),
        'status', status::text, 'config', config, 'updatedAt', updated_at
      )) order by id)
      from public.integrations
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.save_crm_state_normalized(jsonb) from public, anon, authenticated;
revoke all on function public.get_crm_state_normalized() from public, anon, authenticated;
grant execute on function public.save_crm_state_normalized(jsonb) to service_role;
grant execute on function public.get_crm_state_normalized() to service_role;
