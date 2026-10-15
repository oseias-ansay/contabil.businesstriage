import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withAdmin } from "@/db";
import { users } from "@/db/schema";
import { getCurrentTenant } from "@/lib/tenant";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { handleError, parseBody, ApiError } from "@/lib/api";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { email, password } = await parseBody(req, schema);
    const tenant = await getCurrentTenant();
    if (!tenant) throw new ApiError(404, "Empresa não encontrada para este domínio");
    if (tenant.status === "SUSPENDED" || tenant.status === "CANCELED") throw new ApiError(403, "Conta suspensa. Fale com o suporte.");

    // Login é sempre escopado ao tenant do domínio acessado
    const [user] = await withAdmin((tx) =>
      tx.select().from(users).where(and(eq(users.tenantId, tenant.id), eq(users.email, email.toLowerCase()))).limit(1),
    );
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new ApiError(401, "E-mail ou senha inválidos");
    }
    await withAdmin((tx) => tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)));

    const token = await signSession({ sub: user.id, tid: tenant.id, role: user.role, name: user.name });
    const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e) {
    return handleError(e);
  }
}
