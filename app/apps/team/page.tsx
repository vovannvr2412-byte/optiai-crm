import { CrmApp } from "@/components/crm-app";
import { requireAppAccess } from "@/lib/os/server";

export default async function TeamPage() {
  await requireAppAccess("team");
  return <CrmApp mode="team" />;
}
