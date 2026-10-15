/**
 * Resolução do tenant a partir do host da requisição.
 *
 *  1. Domínio próprio:    contabil.cliente.com.br                → tenants.domain
 *  2. Subdomínio do SaaS: <slug>.contabil.businesstriage.com.br  → tenants.slug
 *  3. Fallback (localhost/IP): DEFAULT_TENANT_SLUG (Business Triage)
 *
 * Em dev, use ?tenant=<slug> uma vez (vira cookie) para alternar tenants.
 */
import { cache } from "react";
import { eq } from "drizzle-orm";
import { headers, cookies } from "next/headers";
import { withAdmin } from "@/db";
import { tenants, type Tenant } from "@/db/schema";

const ROOT = (process.env.ROOT_DOMAIN ?? "").toLowerCase();
const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? "business-triage";

// Cache em memória (60s) para não bater no banco a cada request
const memo = new Map<string, { tenant: Tenant | null; at: number }>();
const TTL = 60_000;

export function invalidateTenantCache() {
  memo.clear();
}

export async function findTenantByHost(rawHost: string, devSlug?: string): Promise<Tenant | null> {
  const host = rawHost.split(":")[0].toLowerCase();
  const key = `${host}|${devSlug ?? ""}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.tenant;

  const tenant = await withAdmin(async (tx) => {
    // 1) domínio personalizado
    const [byDomain] = await tx.select().from(tenants).where(eq(tenants.domain, host)).limit(1);
    if (byDomain) return byDomain;

    // 2) subdomínio
    let slug: string | undefined;
    if (ROOT && host.endsWith(`.${ROOT}`)) slug = host.slice(0, -(ROOT.length + 1));
    else if (host === ROOT || host === "localhost" || /^[\d.]+$/.test(host)) slug = devSlug ?? DEFAULT_SLUG;
    else slug = devSlug ?? DEFAULT_SLUG;

    const [bySlug] = await tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return bySlug ?? null;
  });

  memo.set(key, { tenant, at: Date.now() });
  return tenant;
}

/** Tenant da requisição atual (Server Components / Route Handlers). */
export const getCurrentTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const c = await cookies();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const devSlug = process.env.NODE_ENV !== "production" ? c.get("dev_tenant")?.value : undefined;
  return findTenantByHost(host, devSlug);
});

/** Converte #RRGGBB em "R G B" (formato usado pelas variáveis do Tailwind). */
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Cor de texto legível (preto/branco) sobre a cor informada. */
export function readableOn(hex: string): string {
  const [r, g, b] = hexToRgbTriplet(hex).split(" ").map(Number);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "15 23 42" : "255 255 255";
}
