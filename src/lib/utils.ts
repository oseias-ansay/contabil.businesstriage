import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const brl = (v: number | string, compact = false) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(Number(v));

/** Normaliza telefone BR para só dígitos com DDI 55. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 11) return `55${d}`;
  return d;
}

/** Substitui {{contact.name}}, {{deal.title}}, {{user.name}} etc. */
export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return renderRaw(tpl, vars).replace(/[ \t]*,[ \t]*(?=[!?.,])/g, ""); // "Olá, !" (nome vazio) → "Olá!"
}

function renderRaw(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], vars);
    return v == null ? "" : String(v);
  });
}

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
