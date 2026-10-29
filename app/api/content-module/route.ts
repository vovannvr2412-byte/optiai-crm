import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { createContentModuleUpload, deleteContentModule, installStagedContentModule } from "@/lib/content-module/store";
import { getCrmStateAsync } from "@/lib/crm/store";
import { recordSecurityAuditSafe } from "@/lib/security/audit";

const ticketSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive()
});
const installSchema = z.object({ path: z.string().min(1).max(500) });

async function owner() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const state = await getCrmStateAsync();
  return state.users.find((item) => item.id === userId && item.status === "active" && item.role === "Руководитель") ?? null;
}

export async function POST(request: Request) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Устанавливать Контент-завод может только руководитель." }, { status: 403 });
  const parsed = ticketSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте выбранный ZIP-архив." }, { status: 400 });
  try {
    return NextResponse.json(await createContentModuleUpload(parsed.data.name, parsed.data.size));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось подготовить загрузку." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Устанавливать Контент-завод может только руководитель." }, { status: 403 });
  const parsed = installSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Не найден загруженный архив." }, { status: 400 });
  try {
    const installation = await installStagedContentModule(parsed.data.path, user);
    await recordSecurityAuditSafe(user, "content_module.installed", "content_module", installation.id, {
      name: installation.name,
      version: installation.version,
      fileCount: installation.fileCount,
      totalBytes: installation.totalBytes
    });
    return NextResponse.json({ module: installation, message: `${installation.name} установлен и доступен сотрудникам с правом «Контент».` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось установить Контент-завод." }, { status: 400 });
  }
}

export async function DELETE() {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Удалять Контент-завод может только руководитель." }, { status: 403 });
  try {
    await deleteContentModule();
    await recordSecurityAuditSafe(user, "content_module.deleted", "content_module");
    return NextResponse.json({ message: "Контент-завод удалён. Доступ сотрудников к приложению сохранён." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить Контент-завод." }, { status: 400 });
  }
}
