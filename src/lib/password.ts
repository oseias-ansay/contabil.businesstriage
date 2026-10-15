/** Regras de senha e tokens de redefinição. */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "A senha precisa ter pelo menos 10 caracteres")
  .max(128)
  .refine((s) => /[a-zA-Z]/.test(s) && /\d/.test(s), "Use letras e números");

export const newResetToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
};
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
