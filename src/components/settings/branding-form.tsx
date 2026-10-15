"use client";
/**
 * Painel White-Label: nome, logotipo, favicon, cores, headline do login
 * e domínio próprio — com pré-visualização ao vivo.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Globe, ImageUp } from "lucide-react";
import { api } from "@/lib/fetcher";
import { MODULES } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Branding = {
  name: string; slug: string; domain: string | null; logoUrl: string | null; faviconUrl: string | null;
  primaryColor: string; secondaryColor: string; loginHeadline: string | null; plan: string; maxUsers: number; maxCompanies: number; enabledModules: string[]; rootDomain?: string;
};

export function BrandingForm() {
  const { data } = useQuery({ queryKey: ["branding"], queryFn: () => api<Branding>("/api/tenant/branding") });
  const [form, setForm] = useState<Branding | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (b: Branding) =>
      api("/api/tenant/branding", { method: "PATCH", json: { name: b.name, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, primaryColor: b.primaryColor, secondaryColor: b.secondaryColor, loginHeadline: b.loginHeadline, domain: b.domain ?? "" } }),
    onSuccess: () => { setSaved(true); setTimeout(() => window.location.reload(), 600); },
  });

  async function upload(file: File, field: "logoUrl" | "faviconUrl") {
    const fd = new FormData();
    fd.append("file", file);
    const r = await api<{ url: string }>("/api/upload", { method: "POST", body: fd });
    setForm((f) => (f ? { ...f, [field]: r.url } : f));
  }

  if (!form) return <p className="text-sm text-slate-500">Carregando…</p>;
  const set = (k: keyof Branding, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader><CardTitle>Identidade visual</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Nome da empresa</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            {(["logoUrl", "faviconUrl"] as const).map((k) => (
              <div key={k}>
                <Label>{k === "logoUrl" ? "Logotipo (fundo escuro, PNG/SVG)" : "Favicon (32×32)"}</Label>
                <label className="flex h-24 cursor-pointer items-center justify-center rounded-lg border border-dashed bg-slate-50 hover:bg-slate-100">
                  {form[k] ? <img src={form[k]!} alt="" className="max-h-16 max-w-[80%] object-contain" /> : <span className="flex items-center gap-2 text-sm text-slate-500"><ImageUp size={16} /> Enviar</span>}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], k)} />
                </label>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {(["primaryColor", "secondaryColor"] as const).map((k) => (
              <div key={k}>
                <Label>{k === "primaryColor" ? "Cor primária" : "Cor secundária (destaques)"}</Label>
                <div className="flex gap-2">
                  <input type="color" value={form[k]} onChange={(e) => set(k, e.target.value.toUpperCase())} className="h-10 w-14 cursor-pointer rounded border" />
                  <Input value={form[k]} onChange={(e) => set(k, e.target.value)} />
                </div>
              </div>
            ))}
          </div>
          <div><Label>Frase da tela de login</Label><Input value={form.loginHeadline ?? ""} onChange={(e) => set("loginHeadline", e.target.value)} /></div>

          <div className="rounded-xl border p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Globe size={16} /> Domínio</p>
            <p className="text-sm text-slate-600">Endereço padrão: <code className="rounded bg-slate-100 px-1">{form.slug}.{form.rootDomain ?? "contabil.businesstriage.com.br"}</code></p>
            <Label className="mt-3">Domínio próprio (opcional)</Label>
            <Input placeholder="contabil.suaempresa.com.br" value={form.domain ?? ""} onChange={(e) => set("domain", e.target.value.trim().toLowerCase())} />
            {form.domain && (
              <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                No DNS do domínio crie um registro <b>CNAME</b> <code>{form.domain.split(".")[0]}</code> → <code>{form.slug}.{form.rootDomain ?? "contabil.businesstriage.com.br"}</code>.
                O SSL é emitido automaticamente (ver docs/DEPLOY.md).
              </p>
            )}
          </div>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{saved ? <><Check size={16} /> Salvo</> : "Salvar marca"}</Button>
        </CardContent>
      </Card>

      {/* Pré-visualização ao vivo */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase text-slate-500">Pré-visualização</p>
        <div className="overflow-hidden rounded-xl border shadow-sm">
          <div className="flex h-56">
            <div className="w-20 space-y-2 p-3" style={{ background: form.primaryColor }}>
              {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-6 object-contain" /> : <p className="truncate text-[10px] font-bold text-white">{form.name}</p>}
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-2 rounded bg-white/30" />)}
            </div>
            <div className="flex-1 space-y-2 bg-slate-50 p-3">
              <div className="flex gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex-1 rounded-lg bg-white p-2 shadow-sm">
                    <div className="mb-1 h-1.5 rounded" style={{ background: form.secondaryColor }} />
                    <div className="h-2 w-2/3 rounded bg-slate-200" />
                  </div>
                ))}
              </div>
              <button className="rounded-md px-3 py-1 text-xs text-white" style={{ background: form.primaryColor }}>Botão primário</button>
              <span className="ml-2 rounded-full px-2 py-0.5 text-[10px]" style={{ background: `${form.secondaryColor}22`, color: form.secondaryColor }}>destaque</span>
            </div>
          </div>
        </div>
        <Card>
          <CardContent className="text-sm">
            <p className="font-semibold">Plano {form.plan}</p>
            <p className="text-slate-500">Até {form.maxUsers} usuários · {form.maxCompanies} empresa(s)</p>
            <p className="mt-2 text-xs text-slate-500">Módulos: {form.enabledModules.map((k) => MODULES.find((m) => m.key === k)?.label ?? k).join(" · ")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
