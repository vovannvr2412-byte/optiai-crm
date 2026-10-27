import Link from "next/link";
import { ArrowLeft, FileStack, Settings2 } from "lucide-react";
import { requireAppAccess } from "@/lib/os/server";

export default async function ContentPage() {
  await requireAppAccess("content");
  return (
    <main className="os-module-page">
      <header className="os-module-bar"><Link href="/" aria-label="К приложениям"><ArrowLeft size={18} /></Link><div><strong>Контент</strong><span>Производственный контур материалов</span></div></header>
      <section className="os-content-empty"><FileStack size={28} /><h1>Источник контента не подключён</h1><p>Модуль выделен в отдельное приложение и готов к подключению контент-планировщика через API. Демонстрационные публикации и вымышленные показатели не создаются.</p><Link href={{ pathname: "/apps/settings" }}><Settings2 size={17} /> Открыть настройки</Link></section>
    </main>
  );
}
