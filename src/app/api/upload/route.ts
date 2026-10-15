/**
 * POST /api/upload (multipart: file) — imagens da marca (logotipo e favicon).
 * Salva em disco (UPLOAD_DIR/<tenantId>/...). Em várias instâncias, troque por S3/R2.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError, route } from "@/lib/api";

const MAX = 2 * 1024 * 1024; // 2 MB
const ALLOWED = /^image\/(png|jpeg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;

export const POST = route(
  async (req, { auth }) => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Arquivo ausente");
    if (file.size > MAX) throw new ApiError(413, "Imagem maior que 2 MB");
    if (!ALLOWED.test(file.type)) throw new ApiError(415, "Envie PNG, JPG, WEBP, SVG ou ICO");

    const ext = path.extname(file.name).replace(/[^.\w]/g, "").slice(0, 8);
    const rel = `${auth.tenantId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    const base = path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
    await mkdir(path.dirname(path.join(base, rel)), { recursive: true });
    await writeFile(path.join(base, rel), Buffer.from(await file.arrayBuffer()));
    return { url: `/uploads/${rel}`, fileName: file.name, mimeType: file.type, size: file.size };
  },
  { minRole: "OWNER" },
);
