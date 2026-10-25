import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { sendPushToUser } from "@/lib/push/store";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  try {
    const result = await sendPushToUser(userId, {
      title: "OptiAI CRM",
      body: "Тестовое уведомление доставлено. Push работает на этом устройстве.",
      url: "/?view=tasks",
      tag: `push-test-${Date.now()}`
    });
    if (result.sent === 0) {
      const error = result.failed > 0
        ? "Push-сервис отклонил подписку. Переподключите уведомления на этом устройстве."
        : "Для аккаунта нет активной push-подписки. Отключите и включите уведомления заново.";
      return NextResponse.json({ ...result, error }, { status: 424 });
    }
    return NextResponse.json({ ...result, message: "Тестовое push-уведомление отправлено." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось отправить тестовый push." }, { status: 500 });
  }
}
