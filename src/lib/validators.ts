/** Schemas Zod compartilhados entre API e formulários. */
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use #RRGGBB)");

export const brandingSchema = z.object({
  name: z.string().min(2).max(120),
  logoUrl: z.string().nullish(),
  faviconUrl: z.string().nullish(),
  primaryColor: hex,
  secondaryColor: hex,
  loginHeadline: z.string().max(160).nullish(),
  domain: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Domínio inválido")
    .nullish()
    .or(z.literal("")),
});

export const tenantAdminSchema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/, "Use letras minúsculas, números e hífen"),
  domain: z.string().nullish(),
  plan: z.enum(["STARTER", "PRO", "BUSINESS", "ENTERPRISE"]).default("STARTER"),
  status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED", "CANCELED"]).default("TRIAL"),
  maxUsers: z.coerce.number().int().min(1).default(3),
  maxCompanies: z.coerce.number().int().min(1).default(1),
  enabledModules: z.array(z.string()).default(["ledger", "reports"]),
  primaryColor: hex.default("#0F2A44"),
  secondaryColor: hex.default("#14B8A6"),
  owner: z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(10) }).optional(),
});
