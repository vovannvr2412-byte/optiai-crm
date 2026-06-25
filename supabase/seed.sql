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
('20000000-0000-0000-0000-000000000001', 'Владимир Орлов', 'owner@optiai.ru', 'Руководитель', 'CEO OptiAI', 18, 9, 1945000, 34),
('20000000-0000-0000-0000-000000000002', 'Екатерина Нечаева', 'rop@optiai.ru', 'РОП', 'Руководитель отдела продаж', 36, 18, 1324000, 27),
('20000000-0000-0000-0000-000000000003', 'Анна Власова', 'anna@optiai.ru', 'Менеджер', 'Senior sales manager', 58, 14, 842000, 21),
('20000000-0000-0000-0000-000000000004', 'Илья Морозов', 'ilya@optiai.ru', 'Менеджер', 'Sales manager', 47, 11, 617000, 18),
('20000000-0000-0000-0000-000000000005', 'София Лебедева', 'sofia@optiai.ru', 'Аккаунт-менеджер', 'Account manager', 39, 9, 486000, 16)
on conflict (email) do nothing;

insert into public.warmup_sequences (id, name, description, active) values
('30000000-0000-0000-0000-000000000001', 'SEO + GEO прогрев после первого контакта', 'VSL, SEO-аудит, кейс из смежной ниши, аудит конкурентов.', true)
on conflict do nothing;

insert into public.warmup_steps (sequence_id, day, title, message, content_type, sort_order) values
('30000000-0000-0000-0000-000000000001', 1, 'VSL с обзором платформы', 'Отправить VSL с обзором OptiAI.', 'VSL', 1),
('30000000-0000-0000-0000-000000000001', 2, 'SEO аудит и потенциал сайта', 'Отправить персональный SEO + GEO аудит.', 'SEO audit', 2),
('30000000-0000-0000-0000-000000000001', 4, 'Кейс из смежной ниши', 'Подобрать кейс под отрасль клиента.', 'Case', 3),
('30000000-0000-0000-0000-000000000001', 5, 'Аудит конкурентов', 'Показать упущенный спрос и LLM-видимость.', 'Competitor audit', 4);

insert into public.integrations (id, name, description, status) values
('telegram', 'Telegram Bot API', 'Отправка и получение сообщений', 'connected'),
('whatsapp', 'WhatsApp Business API', 'Шаблоны, входящие и исходящие диалоги', 'connected'),
('max', 'MAX', 'Сообщения и история переписки', 'needs_setup'),
('instagram', 'Instagram', 'Direct, Reels, комментарии, лид-магниты', 'connected'),
('avito', 'Avito', 'Сообщения, заявки и звонки', 'connected'),
('sheets', 'Google Sheets', 'Экспорт и сверка данных', 'connected'),
('metrika', 'Яндекс Метрика', 'Посещения сайта и конверсии', 'connected'),
('robokassa', 'RoboKassa', 'Оплаты подписок', 'connected'),
('sip', 'SIP-телефония', 'Звонки, записи, автодозвон', 'connected')
on conflict (id) do nothing;
