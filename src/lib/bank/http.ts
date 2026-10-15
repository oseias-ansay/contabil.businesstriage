/** Helpers das rotas de extrato: leitura do arquivo enviado e do mapeamento de colunas. */
import { z } from "zod";
import { ApiError } from "../api";
import { BankParseError, decodeText, detectFormat, guessCsvMapping, parseCsv, parseOfx, type CsvMapping, type ParseResult } from "./parse";

const MAX = 5 * 1024 * 1024; // 5 MB

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
  if (file.size > MAX) throw new ApiError(413, "Arquivo maior que 5 MB");
  if (!/\.(ofx|qfx|csv|txt)$/i.test(file.name)) throw new ApiError(415, "Envie um arquivo OFX ou CSV");
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  let mapping: CsvMapping | undefined;
  const raw = form.get("mapping");
  if (typeof raw === "string" && raw) {
    try {
      mapping = mappingSchema.parse(JSON.parse(raw));
    } catch {
      throw new ApiError(422, "Mapeamento de colunas inválido");
    }
  }
  return { file, text, mapping, form };
}

/** Lê o extrato; para CSV sem mapeamento informado, usa o mapeamento adivinhado. */
export function parseStatement(text: string, mapping?: CsvMapping): ParseResult & { guess?: ReturnType<typeof guessCsvMapping> } {
  try {
    if (detectFormat(text) === "OFX") return parseOfx(text);
    const guess = guessCsvMapping(text);
    return { ...parseCsv(text, mapping ?? guess), guess };
  } catch (e) {
    if (e instanceof BankParseError) throw new ApiError(422, e.message);
    throw e;
  }
}
