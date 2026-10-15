/** Formatação para tela e PDF (sem dependências de servidor). */

/** "12345678000190" → "12.345.678/0001-90"; CPF também. */
export function formatDoc(d: string | null | undefined) {
  if (!d) return "—";
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}

/** "2026-03-15" → "15/03/2026". */
export const dmy = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/** "2026-03" → "março/2026". */
export function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${names[m - 1]}/${y}`;
}

/** Centavos → "R$ 1.234,56" (vazio para zero, se pedido). */
export function brlCents(cents: number, blankZero = false) {
  if (blankZero && !cents) return "–";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** String do banco ("1234.50") → "R$ 1.234,50". */
export const brlStr = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
