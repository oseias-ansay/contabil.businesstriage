/**
 * Middleware (Edge):
 *  - protege as páginas (redireciona para /login sem sessão)
 *  - protege /admin (somente SUPER_ADMIN)
 *  - em dev, ?tenant=<slug> grava cookie para simular subdomínios
 * A resolução do tenant em si acontece no servidor (src/lib/tenant.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/api/auth/login", "/api/auth/forgot", "/api/auth/reset", "/api/health", "/uploads", "/_next", "/favicon", "/icon"];

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  if (process.env.NODE_ENV !== "production" && searchParams.get("tenant")) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("tenant");
    const res = NextResponse.redirect(url);
    res.cookies.set("dev_tenant", searchParams.get("tenant")!, { path: "/" });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api")) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && session.role !== "SUPER_ADMIN") {
    return pathname.startsWith("/api") ? NextResponse.json({ error: "Sem permissão" }, { status: 403 }) : NextResponse.redirect(new URL("/painel", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|svg|ico|webp)$).*)"] };
