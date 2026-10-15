/**
 * POST /api/auth/forgot { email } — envia link de redefinição (válido por 1 hora).
 * Sempre responde "ok" (não revela se o e-mail existe).
 */
import { NextResponse } from "next/server";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withAdmin } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { getCurrentTenant } from "@/lib/tenant";
import { handleError, parseBody } from "@/lib/api";
import { newResetToken } from "@/lib/password";
import { sendEmail } from "@/lib/email";

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  try {
    const { email } = await parseBody(req, schema);
    const tenant = await getCurrentTenant();
    if (!tenant) return NextResponse.json({ ok: true });

    const result = await withAdmin(async (tx) => {
      const [u] = await tx
        .select()
        .from(users)
        .where(and(eq(users.tenantId, tenant.id), eq(users.email, email.toLowerCase()), eq(users.isActive, true)))
        .limit(1);
      if (!u) return null;
      // Anti-abuso: no máximo 3 pedidos por hora por usuário
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(passwordResets)
        .where(and(eq(passwordResets.userId, u.id), gte(passwordResets.createdAt, new Date(Date.now() - 3_600_000))));
      if (n >= 3) return null;
      const { token, hash } = newResetToken();
      await tx.insert(passwordResets).values({ tenantId: tenant.id, userId: u.id, tokenHash: hash, expiresAt: new Date(Date.now() + 3_600_000) });
      // invalida pedidos anteriores ainda não usados
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, u.id), isNull(passwordResets.usedAt), sql`${passwordResets.tokenHash} <> ${hash}`));
      return { u, token };
    });

    if (result) {
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      const link = `https://${host}/reset-password?token=${result.token}`;
      await sendEmail({
        to: result.u.email,
        subject: `${tenant.name} — redefinição de senha`,
        html: `<p>Olá, ${result.u.name}.</p><p>Recebemos um pedido para redefinir sua senha do Triage Contábil ${tenant.name}.</p>
               <p><a href="${link}">Clique aqui para criar uma nova senha</a> (válido por 1 hora).</p>
               <p>Se não foi você, ignore este e-mail — sua senha atual continua valendo.</p>`,
        settings: tenant.settings,
      }).catch((e) => console.error("[forgot] e-mail:", e));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
