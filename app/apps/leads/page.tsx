import { CrmApp } from "@/components/crm-app";
import { requireAppAccess } from "@/lib/os/server";

export default async function LeadsPage() {
  await requireAppAccess("leads");
  return <CrmApp mode="leads" />;
}
