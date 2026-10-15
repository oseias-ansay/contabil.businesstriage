/**
 * Dinheiro sem ponto flutuante: tudo é somado em centavos (inteiros).
 * O banco guarda numeric(18,2) e devolve string ("1234.50").
 */
export type Money = string; // formato do banco: "1234.50"

/** "1.234,56" | "1234.56" | 1234.56 → 123456 (centavos). */
export function toCents(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Valor inválido");
    return Math.round(v * 100);
  }
  let s = v.trim().replace(/\s|R\$/g, "");
  // formato brasileiro: 1.234,56
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Valor inválido: ${v}`);
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Valor grande demais");
  return neg ? -cents : cents;
}

/** 123456 → "1234.56" (para gravar no banco). */
export function fromCents(cents: number): Money {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 123456 → "R$ 1.234,56". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
