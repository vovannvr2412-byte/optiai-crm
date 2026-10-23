import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { createMediaUpload, saveLocalMedia, validateMediaMeta } from "@/lib/media/storage";

const ticketSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  size: z.number().int().positive()
});

export async function POST(request: Request) {
  if (!await getSessionUserId()) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const parsed = ticketSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте выбранный файл." }, { status: 400 });
  try {
    return NextResponse.json(await createMediaUpload(parsed.data.name, parsed.data.type, parsed.data.size));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось подготовить загрузку." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  if (!await getSessionUserId()) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const fileName = String(form.get("fileName") ?? "");
    if (!(file instanceof File) || !fileName) return NextResponse.json({ error: "Файл не найден." }, { status: 400 });
    validateMediaMeta({ name: file.name, type: file.type, size: file.size });
    saveLocalMedia(fileName, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ url: new URL(`/api/media/${encodeURIComponent(fileName)}`, request.url).toString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить файл." }, { status: 400 });
  }
}
