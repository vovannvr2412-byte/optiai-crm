import { CrmApp } from "@/components/crm-app";
import { requireAppAccess } from "@/lib/os/server";

export default async function ManagementPage() {
  await requireAppAccess("management");
  return <CrmApp mode="management" />;
}
