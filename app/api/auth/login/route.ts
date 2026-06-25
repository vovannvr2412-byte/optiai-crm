import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureCredentials, verifyCredential } from "@/lib/auth/credentials";
import { setSession } from "@/lib/auth/session";
import { getCrmState } from "@/lib/crm/store";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Введите корректный email и пароль" }, { status: 400 });
  }

  const state = getCrmState();
  ensureCredentials(state.users);
  const userId = verifyCredential(parsed.data.email, parsed.data.password);
  const user = userId ? state.users.find((item) => item.id === userId && item.status === "active") : null;
  if (!user) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  await setSession(user.id);
  return NextResponse.json({ user });
}
