/** Funções de texto dos extratos, sem dependências de servidor (usadas também na tela). */

/** Normaliza para comparar históricos: minúsculas, sem acentos e espaços repetidos. */
export function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Histórico sem números (datas, ids de PIX, nº de documento) para reconhecer "o mesmo" fornecedor/cliente. */
export const signature = (normalized: string) =>
  normalized
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const GENERIC = new Set(["pix", "ted", "doc", "pag", "pgto", "pagamento", "recebido", "enviado", "transf", "transferencia", "de", "da", "do", "para", "compra", "debito", "credito", "cartao"]);

/** Sugestão de texto para uma regra criada a partir de um movimento: as primeiras palavras sem números. */
export function patternFromDescription(description: string) {
  return signature(normalizeText(description))
    .split(" ")
    .filter((w) => w.length >= 2 && !GENERIC.has(w))
    .slice(0, 3)
    .join(" ");
}
