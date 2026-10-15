/**
 * Layout raiz: aplica a identidade visual (white-label) do tenant do domínio
 * acessado — cores via variáveis CSS, favicon e título.
 */
import type { Metadata } from "next";
import { getCurrentTenant, hexToRgbTriplet, readableOn } from "@/lib/tenant";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getCurrentTenant();
  const name = t?.name ?? "Triage Contábil";
  return {
    title: { default: `${name} · Contábil`, template: `%s · ${name}` },
    icons: t?.faviconUrl ? [{ url: t.faviconUrl }] : undefined,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = await getCurrentTenant();
  const primary = t?.primaryColor ?? "#0F2A44";
  const secondary = t?.secondaryColor ?? "#14B8A6";
  const themeCss = `:root{--color-primary:${hexToRgbTriplet(primary)};--color-primary-fg:${readableOn(primary)};--color-secondary:${hexToRgbTriplet(secondary)};--color-secondary-fg:${readableOn(secondary)};}`;

  return (
    <html lang="pt-BR">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
