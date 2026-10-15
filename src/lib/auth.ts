/** Helpers de autenticação/autorização para Server Components e rotas. */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";
import { getCurrentTenant } from "./tenant";

export type AuthContext = SessionPayload & { tenantId: string; userId: string };

const RANK: Record<SessionPayload["role"], number> = { VIEWER: 1, OPERATOR: 2, MANAGER: 3, OWNER: 4, SUPER_ADMIN: 5 };

export function hasRole(role: SessionPayload["role"], min: SessionPayload["role"]) {
  return RANK[role] >= RANK[min];
}

/**
 * Lê a sessão e confere se o token pertence ao tenant do host atual.
 * Impede que um cookie de um tenant seja usado no domínio de outro.
 */
export async function getAuth(): Promise<AuthContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  // Cada sessão vale só para o tenant em que foi criada
  if (session.tid !== tenant.id) return null;
  return { ...session, tenantId: session.tid, userId: session.sub };
}

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}
