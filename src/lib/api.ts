/**
 * Utilitários para Route Handlers: autenticação, erros padronizados
 * e validação com Zod.
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { getAuth, hasRole, type AuthContext } from "./auth";
import type { SessionPayload } from "./session";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

type Handler<P> = (req: Request, ctx: { auth: AuthContext; params: P }) => Promise<Response | unknown>;

/**
 * Envolve um handler exigindo login (e, opcionalmente, papel mínimo).
 * Retornos que não são Response viram JSON automaticamente.
 */
export function route<P = Record<string, string>>(handler: Handler<P>, opts: { minRole?: SessionPayload["role"] } = {}) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const auth = await getAuth();
      if (!auth) throw new ApiError(401, "Não autenticado");
      if (opts.minRole && !hasRole(auth.role, opts.minRole)) throw new ApiError(403, "Sem permissão");
      const params = (await ctx?.params) ?? ({} as P);
      const result = await handler(req, { auth, params });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return handleError(err);
    }
  };
}

export function handleError(err: unknown) {
  if (err instanceof ApiError) return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  if (err instanceof ZodError) return NextResponse.json({ error: "Dados inválidos", details: err.flatten() }, { status: 422 });
  console.error("[api]", err);
  return NextResponse.json({ error: "Erro interno" }, { status: 500 });
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  const json = await req.json().catch(() => {
    throw new ApiError(400, "JSON inválido");
  });
  return schema.parse(json);
}

export function notFound(what = "Registro", feminine = false): never {
  throw new ApiError(404, `${what} não encontrad${feminine ? "a" : "o"}`);
}
