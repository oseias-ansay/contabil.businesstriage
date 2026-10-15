/** E-mail via SMTP (nodemailer). Tenant pode usar SMTP próprio (settings.smtp). */
import nodemailer from "nodemailer";
import type { TenantSettings } from "@/db/schema";

export async function sendEmail(opts: { to: string; subject: string; html: string; settings?: TenantSettings }) {
  const s = opts.settings?.smtp;
  const host = s?.host ?? process.env.SMTP_HOST;
  if (!host) {
    console.warn("[email] SMTP não configurado — e-mail não enviado (modo simulação)");
    return { externalId: undefined };
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(s?.port ?? process.env.SMTP_PORT ?? 465),
    secure: Number(s?.port ?? process.env.SMTP_PORT ?? 465) === 465,
    auth: { user: s?.user ?? process.env.SMTP_USER, pass: s?.pass ?? process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({ from: s?.from ?? process.env.SMTP_FROM, to: opts.to, subject: opts.subject, html: opts.html });
  return { externalId: info.messageId };
}
