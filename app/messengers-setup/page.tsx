const channels = [
  {
    name: "Telegram",
    env: "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET",
    steps: "Создайте бота через @BotFather. Установите setWebhook на /api/messaging/webhooks/telegram и передайте секрет как secret_token."
  },
  {
    name: "WhatsApp Business Cloud API",
    env: "WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET",
    steps: "Создайте Business-приложение Meta, подключите номер и подпишите webhook /api/messaging/webhooks/whatsapp на поле messages."
  },
  {
    name: "MAX",
    env: "MAX_BOT_TOKEN, MAX_WEBHOOK_SECRET",
    steps: "Создайте бота на платформе MAX и зарегистрируйте HTTPS webhook /api/messaging/webhooks/max через POST /subscriptions на platform-api2.max.ru."
  },
  {
    name: "Instagram",
    env: "INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID, INSTAGRAM_VERIFY_TOKEN, INSTAGRAM_APP_SECRET",
    steps: "Подключите профессиональный аккаунт через Meta, задайте callback /api/messaging/webhooks/instagram и подпишитесь на события сообщений."
  },
  {
    name: "Avito",
    env: "AVITO_CLIENT_ID, AVITO_CLIENT_SECRET, AVITO_USER_ID, AVITO_WEBHOOK_SECRET",
    steps: "Создайте приложение Avito с Messenger API. CRM проверит аккаунт, зарегистрирует webhook и сможет загрузить историю чатов."
  }
];

export default function MessengersSetupPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-10">
      <p className="text-xs font-bold uppercase text-[#536DFE]">OptiAI CRM</p>
      <h1 className="mt-2 text-3xl font-bold text-[#202939]">Подключение мессенджеров</h1>
      <p className="mt-3 max-w-2xl leading-6 text-slate-600">Войдите в CRM как руководитель, откройте «Автоматизации» и выберите нужный мессенджер. Ключи можно менять прямо в форме: они шифруются на сервере и не возвращаются в браузер.</p>
      <div className="mt-8 grid gap-4">
        {channels.map((channel) => (
          <section key={channel.name} className="rounded-lg border border-[#E5E7EB] bg-white p-5">
            <h2 className="text-lg font-bold">{channel.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{channel.steps}</p>
            <code className="mt-3 block overflow-x-auto rounded-md bg-slate-100 p-3 text-xs text-slate-700">Резервные переменные Vercel: {channel.env}</code>
          </section>
        ))}
      </div>
      <section className="mt-6 border-l-4 border-[#536DFE] bg-[#EEF1FF] p-4 text-sm leading-6 text-[#263264]">
        Для production выполните миграции центра сообщений, media storage и `0008_external_integrations_and_web_push.sql`. В Vercel обязательно сохраните постоянный `AUTH_SECRET`: он используется для шифрования ключей. Полная пошаговая инструкция находится в `MESSENGERS_SETUP.md` репозитория.
      </section>
    </main>
  );
}
