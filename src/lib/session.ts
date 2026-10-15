/**
 * Sessão via JWT assinado (jose) em cookie httpOnly.
 * Compatível com Edge (middleware) e Node (rotas).
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "contabil_session";

export type SessionPayload = {
  sub: string; // userId
  tid: string; // tenantId
  role: "SUPER_ADMIN" | "OWNER" | "MANAGER" | "OPERATOR" | "VIEWER";
  name: string;
};

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");

export async function signSession(payload: SessionPayload, maxAgeSec = 60 * 60 * 24 * 7) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(secret());
}

export async function verifySession(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
