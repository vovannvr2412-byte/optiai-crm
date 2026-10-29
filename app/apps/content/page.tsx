import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ContentModuleManager } from "@/components/content-module-manager";
import { getContentModuleInstallation } from "@/lib/content-module/store";
import { requireAppAccess } from "@/lib/os/server";

export default async function ContentPage() {
  const { user } = await requireAppAccess("content");
  let installation = null;
  let loadError: string | undefined;
  try {
    installation = await getContentModuleInstallation();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Не удалось проверить подключение Контент-завода.";
  }
  return (
    <main className="os-module-page">
      <header className="os-module-bar"><Link href="/" aria-label="К приложениям"><ArrowLeft size={18} /></Link><div><strong>Контент</strong><span>Производственный контур материалов</span></div></header>
      <ContentModuleManager initialInstallation={installation} isOwner={user.role === "Руководитель"} loadError={loadError} />
    </main>
  );
}
