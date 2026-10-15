/** POST /api/auth/reset { token, password } — conclui a redefinição de senha */
import { NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withAdmin } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { getCurrentTenant } from "@/lib/tenant";
import { ApiError, handleError, parseBody } from "@/lib/api";
import { hashToken, passwordSchema } from "@/lib/password";

const schema = z.object({ token: z.string().min(20), password: passwordSchema });

export async function POST(req: Request) {
  try {
    const { token, password } = await parseBody(req, schema);
    const tenant = await getCurrentTenant();
    await withAdmin(async (tx) => {
      const [r] = await tx
        .select()
        .from(passwordResets)
        .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
        .limit(1);
      if (!r || r.tenantId !== tenant?.id) throw new ApiError(400, "Link inválido ou expirado. Peça um novo.");
      await tx.update(users).set({ passwordHash: await bcrypt.hash(password, 12) }).where(eq(users.id, r.userId));
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, r.id));
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
