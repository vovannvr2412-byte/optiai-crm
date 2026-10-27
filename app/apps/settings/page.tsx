import { CrmApp } from "@/components/crm-app";
import { requireAppAccess } from "@/lib/os/server";

export default async function SettingsPage() {
  await requireAppAccess("settings");
  return <CrmApp mode="settings" />;
}
