/** Helpers das rotas de extrato: leitura do arquivo enviado e do mapeamento de colunas. */
import { z } from "zod";
import { ApiError } from "../api";
import { BankParseError, decodeText, detectFormat, guessCsvMapping, parseCsv, parseOfx, type CsvMapping, type ParseResult } from "./parse";
import { isPdf, parsePdf } from "./pdf";

const MAX = 10 * 1024 * 1024; // 10 MB (PDFs de vários meses)

const mappingSchema = z.object({
  delimiter: z.string().min(1).max(2),
  hasHeader: z.boolean(),
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  amount: z.number().int().min(0).optional(),
  debit: z.number().int().min(0).optional(),
  credit: z.number().int().min(0).optional(),
  type: z.number().int().min(0).optional(),
  document: z.number().int().min(0).optional(),
});

export async function readStatementForm(req: Request) {
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "Envie o arquivo como formulário (multipart)");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Arquivo ausente");
  if (file.size > MAX) throw new ApiError(413, "Arquivo maior que 10 MB");
  if (!/\.(ofx|qfx|csv|txt|pdf)$/i.test(file.name)) throw new ApiError(415, "Envie um arquivo OFX, CSV ou PDF");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = isPdf(bytes);
  if (/\.pdf$/i.test(file.name) && !pdf) throw new ApiError(415, "O arquivo não é um PDF válido");
  const text = pdf ? "" : decodeText(bytes);
  const pw = form.get("pdfPassword");
  const password = typeof pw === "string" && pw ? pw.slice(0, 100) : undefined;
  let mapping: CsvMapping | undefined;
  const raw = form.get("mapping");
  if (typeof raw === "string" && raw) {
    try {
      mapping = mappingSchema.parse(JSON.parse(raw));
    } catch {
      throw new ApiError(422, "Mapeamento de colunas inválido");
    }
  }
  return { file, text, bytes: pdf ? bytes : null, password, mapping, form };
}

/** Lê o extrato; para CSV sem mapeamento informado, usa o mapeamento adivinhado. */
export async function parseStatement(input: { text: string; bytes: Uint8Array | null; password?: string; mapping?: CsvMapping }): Promise<ParseResult & { guess?: ReturnType<typeof guessCsvMapping> }> {
  const { text, bytes, password, mapping } = input;
  try {
    if (bytes) return await parsePdf(bytes, password);
    if (detectFormat(text) === "OFX") return parseOfx(text);
    const guess = guessCsvMapping(text);
    return { ...parseCsv(text, mapping ?? guess), guess };
  } catch (e) {
    if (e instanceof BankParseError) throw new ApiError(422, e.message);
    throw e;
  }
}
