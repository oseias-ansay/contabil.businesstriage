"use client";
/** "Minha conta": troca da própria senha. */
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/fetcher";

export function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => { setMsg(null); onOpenChange(v); }} title="Minha conta — trocar senha">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (f.get("newPassword") !== f.get("confirm")) return setMsg({ ok: false, text: "As senhas novas não conferem" });
          setLoading(true);
          try {
            await api("/api/auth/password", { method: "POST", json: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
            setMsg({ ok: true, text: "Senha alterada com sucesso." });
            e.currentTarget.reset();
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          } finally {
            setLoading(false);
          }
        }}
      >
        <div><Label>Senha atual</Label><Input name="currentPassword" type="password" required autoComplete="current-password" /></div>
        <div><Label>Nova senha</Label><Input name="newPassword" type="password" minLength={10} required autoComplete="new-password" /></div>
        <div><Label>Repita a nova senha</Label><Input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></div>
        <p className="text-xs text-slate-500">Mínimo de 10 caracteres, com letras e números.</p>
        {msg && <p className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-red-600"}>{msg.text}</p>}
        <Button type="submit" disabled={loading}>{loading ? "Salvando…" : "Salvar nova senha"}</Button>
      </form>
    </Dialog>
  );
}
