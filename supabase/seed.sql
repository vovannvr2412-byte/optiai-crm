insert into public.tariffs (id, code, name, price) values
('10000000-0000-0000-0000-000000000001', 'start', 'SEO + GEO Start', 14900),
('10000000-0000-0000-0000-000000000002', 'growth', 'SEO + GEO Growth', 71400),
('10000000-0000-0000-0000-000000000003', 'dominance', 'SEO + GEO Dominance', 118800)
on conflict (code) do nothing;

insert into public.pipeline_stages (stage_order, name, requires_refusal_reason, creates_callback_tasks) values
(0, 'Новый лид', false, false),
(1, 'Контакт найден', false, false),
(2, 'Первый звонок', false, false),
(3, 'Не дозвонились', false, true),
(4, 'Разговор состоялся', false, false),
(5, 'Отправлен аудит', false, false),
(6, 'Прогрев', false, false),
(7, 'Сделка или отказ', false, false),
(8, 'Оплата', false, false),
(9, 'Подключен', false, false),
(10, 'Продление', false, false),
(11, 'Апселл', false, false),
(12, 'Отказ', true, false)
on conflict (stage_order) do nothing;

insert into public.crm_users (id, full_name, email, role, position, calls, meetings, revenue, conversion) values
('20000000-0000-0000-0000-000000000001', 'Владимир Орлов', 'owner@optiai.ru', 'Руководитель', 'CEO OptiAI', 0, 0, 0, 0),
('20000000-0000-0000-0000-000000000002', 'Екатерина Нечаева', 'rop@optiai.ru', 'РОП', 'Руководитель отдела продаж', 0, 0, 0, 0),
('20000000-0000-0000-0000-000000000003', 'Анна Власова', 'anna@optiai.ru', 'Менеджер', 'Менеджер по продажам', 0, 0, 0, 0),
('20000000-0000-0000-0000-000000000005', 'София Лебедева', 'sofia@optiai.ru', 'Аккаунт-менеджер', 'Аккаунт-менеджер', 0, 0, 0, 0)
on conflict (email) do update set
  calls = excluded.calls,
  meetings = excluded.meetings,
  revenue = excluded.revenue,
  conversion = excluded.conversion;

insert into public.warmup_sequences (id, name, description, active) values
('30000000-0000-0000-0000-000000000001', 'SEO + GEO прогрев после первого контакта', 'VSL, SEO-аудит, кейс из смежной ниши, аудит конкурентов.', true)
on conflict do nothing;

insert into public.warmup_steps (sequence_id, day, title, message, content_type, sort_order) values
('30000000-0000-0000-0000-000000000001', 1, 'VSL с обзором платформы', 'Отправить VSL с обзором OptiAI.', 'VSL', 1),
('30000000-0000-0000-0000-000000000001', 2, 'SEO аудит и потенциал сайта', 'Отправить персональный SEO + GEO аудит.', 'SEO audit', 2),
('30000000-0000-0000-0000-000000000001', 4, 'Кейс из смежной ниши', 'Подобрать кейс под отрасль клиента.', 'Case', 3),
('30000000-0000-0000-0000-000000000001', 5, 'Аудит конкурентов', 'Показать упущенный спрос и LLM-видимость.', 'Competitor audit', 4);

insert into public.integrations (id, name, description, status) values
('telegram', 'Telegram Bot API', 'Отправка и получение сообщений', 'needs_setup'),
('whatsapp', 'WhatsApp Business API', 'Шаблоны, входящие и исходящие диалоги', 'needs_setup'),
('max', 'MAX', 'Сообщения и история переписки', 'needs_setup'),
('instagram', 'Instagram', 'Direct, Reels, комментарии, лид-магниты', 'needs_setup'),
('avito', 'Avito', 'Сообщения, заявки и звонки', 'needs_setup'),
('sheets', 'Google Sheets', 'Экспорт и сверка данных', 'needs_setup'),
('metrika', 'Яндекс Метрика', 'Посещения сайта и конверсии', 'needs_setup'),
('robokassa', 'RoboKassa', 'Оплаты подписок', 'needs_setup'),
('sip', 'SIP-телефония', 'Звонки, записи, автодозвон', 'needs_setup')
on conflict (id) do update set status = excluded.status;
