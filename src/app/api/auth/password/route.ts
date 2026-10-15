/** POST /api/auth/password { currentPassword, newPassword } — o próprio usuário troca a senha */
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withTenant } from "@/db";
import { users } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { passwordSchema } from "@/lib/password";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export const POST = route(async (req, { auth }) => {
  const { currentPassword, newPassword } = await parseBody(req, schema);
  await withTenant(auth.tenantId, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, auth.userId)).limit(1);
    if (!u || !(await bcrypt.compare(currentPassword, u.passwordHash))) throw new ApiError(400, "Senha atual incorreta");
    if (currentPassword === newPassword) throw new ApiError(400, "A nova senha deve ser diferente da atual");
    await tx.update(users).set({ passwordHash: await bcrypt.hash(newPassword, 12) }).where(eq(users.id, u.id));
  });
  return { ok: true };
});
