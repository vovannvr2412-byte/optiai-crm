import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RoutinesModule } from "@/components/routines/routines-module";
import { requireAppAccess } from "@/lib/os/server";
import "../../routines.css";

export default async function RoutinesPage() {
  const { state } = await requireAppAccess("routines");
  const team = state.users.filter((user) => user.status === "active").map((user) => ({ id: user.id, fullName: user.fullName }));
  return <main className="os-module-page"><header className="os-module-bar"><Link href="/" aria-label="К приложениям"><ArrowLeft size={18} /></Link><div><strong>Рутины</strong><span>Операционная неделя и регулярные процессы</span></div></header><RoutinesModule teamMembers={team} /></main>;
}
