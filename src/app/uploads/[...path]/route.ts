/**
 * GET /uploads/<tenantId>/<aaaa-mm>/<uuid>.<ext>
 * Serve as imagens da marca (UPLOAD_DIR) — necessário no Docker, onde não há
 * Nginx servindo o disco. Nomes são UUID aleatórios (não adivinháveis).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  // Só aceita segmentos simples (sem "..", barras ou caracteres estranhos)
  if (!parts.length || parts.some((p) => !/^[\w.-]+$/.test(p) || p.startsWith("."))) {
    return new Response("Not found", { status: 404 });
  }
  const base = path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
  const file = path.resolve(base, ...parts);
  if (!file.startsWith(base + path.sep)) return new Response("Not found", { status: 404 });

  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error();
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(st.size),
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Content-Type-Options": "nosniff",
        // SVG nunca executa scripts a partir daqui
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        ...(type === "application/octet-stream" && { "Content-Disposition": "attachment" }),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
