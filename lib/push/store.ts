import webpush from "web-push";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { getIntegrationSecrets, saveIntegrationSecrets } from "@/lib/integrations/secrets";
import { supabasePersistenceEnabled } from "@/lib/crm/store";

type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

async function vapidConfiguration() {
  const stored = await getIntegrationSecrets("webpush");
  const publicKey = stored.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = stored.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || "";
  const subject = stored.VAPID_SUBJECT || process.env.VAPID_SUBJECT || "";
  return { publicKey, privateKey, subject };
}

export async function ensureVapidConfiguration(email: string) {
  let current: Awaited<ReturnType<typeof vapidConfiguration>>;
  try {
    current = await vapidConfiguration();
  } catch {
    // If AUTH_SECRET changed, the legacy shared container cannot be decrypted.
    // Generate a fresh per-integration VAPID configuration instead of blocking push setup.
    current = { publicKey: "", privateKey: "", subject: "" };
  }
  if (current.publicKey && current.privateKey && current.subject) return current;
  const generated = webpush.generateVAPIDKeys();
  const subject = `mailto:${email}`;
  await saveIntegrationSecrets("webpush", {
    VAPID_PUBLIC_KEY: generated.publicKey,
    VAPID_PRIVATE_KEY: generated.privateKey,
    VAPID_SUBJECT: subject
  });
  return { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
}

export async function getPushConfiguration() {
  try {
    const config = await vapidConfiguration();
    return { configured: Boolean(config.publicKey && config.privateKey && config.subject), publicKey: config.publicKey };
  } catch {
    return { configured: false, publicKey: "" };
  }
}

export async function savePushSubscription(userId: string, subscription: PushSubscriptionInput, userAgent?: string) {
  if (!supabasePersistenceEnabled()) throw new Error("Web Push требует подключённый Supabase.");
  const { error } = await createServiceSupabaseClient().from("push_subscriptions").upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: userAgent?.slice(0, 500) || null,
    updated_at: new Date().toISOString()
  }, { onConflict: "endpoint" });
  if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205"
    ? "Выполните миграцию 0008_external_integrations_and_web_push.sql в Supabase."
    : error.message);
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  if (!supabasePersistenceEnabled()) return;
  const { error } = await createServiceSupabaseClient().from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
}

export async function hasPushSubscription(userId: string) {
  if (!supabasePersistenceEnabled()) return false;
  const { count, error } = await createServiceSupabaseClient().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return false;
    throw error;
  }
  return Boolean(count);
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!supabasePersistenceEnabled()) return { sent: 0, removed: 0, failed: 0 };
  const config = await vapidConfiguration();
  if (!config.publicKey || !config.privateKey || !config.subject) return { sent: 0, removed: 0, failed: 0 };
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", userId);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return { sent: 0, removed: 0, failed: 0 };
    throw error;
  }
  let sent = 0;
  let removed = 0;
  let failed = 0;
  await Promise.all((data ?? []).map(async (row) => {
    try {
      await webpush.sendNotification({
        endpoint: String(row.endpoint),
        keys: { p256dh: String(row.p256dh), auth: String(row.auth) }
      }, JSON.stringify(payload), { TTL: 86_400, urgency: "high", topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) });
      sent += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", row.id);
        removed += 1;
      } else {
        failed += 1;
        console.error("Web Push delivery failed", { userId, statusCode });
      }
    }
  }));
  return { sent, removed, failed };
}
