"use client";
/** Equipe: adicionar pessoa, mudar papel, ativar/desativar e redefinir senha. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserPlus } from "lucide-react";
import { api } from "@/lib/fetcher";
import { ROLE_LABELS } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type U = { id: string; name: string; email: string; role: string; isActive: boolean; lastLoginAt: string | null };

const ROLE_HELP: Record<string, string> = {
  OWNER: "tudo, inclusive equipe e marca",
  MANAGER: "lança, fecha e reabre meses, cadastra empresas",
  OPERATOR: "lança, importa e classifica extratos",
  VIEWER: "só consulta e exporta relatórios",
};

export function TeamPanel() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["users"], queryFn: () => api<U[]>("/api/users") });
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<U | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api(`/api/users/${v.id}`, { method: "PATCH", json: v.body }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const invite = useMutation({
    mutationFn: (b: unknown) => api("/api/users", { method: "POST", json: b }),
    onSuccess: () => {
      setInviteOpen(false);
      refresh();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{data.filter((u) => u.isActive).length} usuário(s) ativo(s)</p>
        <Button onClick={() => setInviteOpen(true)}><UserPlus size={16} /> Adicionar pessoa</Button>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">Pessoa</th><th className="px-4 py-2">Papel</th><th className="px-4 py-2 text-center">Ativo</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className={cn("border-t", !u.isActive && "opacity-50")}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2"><Avatar name={u.name} /><div><p className="font-medium">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></div></div>
                </td>
                <td className="px-4 py-2">
                  {u.role === "SUPER_ADMIN" ? (
                    <span className="text-xs text-slate-500">Super Admin</span>
                  ) : (
                    <Select className="h-8 text-xs" value={u.role} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>
                      {["OWNER", "MANAGER", "OPERATOR", "VIEWER"].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </Select>
                  )}
                </td>
                <td className="px-4 py-2 text-center"><input type="checkbox" checked={u.isActive} onChange={(e) => patch.mutate({ id: u.id, body: { isActive: e.target.checked } })} /></td>
                <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setPwdUser(u)}><KeyRound size={14} /> Redefinir senha</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ul className="grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
        {Object.entries(ROLE_HELP).map(([r, h]) => <li key={r}><b className="font-medium text-slate-600">{ROLE_LABELS[r]}:</b> {h}</li>)}
      </ul>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="Adicionar pessoa à equipe">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); invite.mutate(Object.fromEntries(new FormData(e.currentTarget))); }}>
          <div><Label>Nome</Label><Input name="name" required /></div>
          <div><Label>E-mail</Label><Input name="email" type="email" required /></div>
          <div><Label>Senha inicial</Label><Input name="password" type="password" minLength={10} required /><p className="mt-1 text-xs text-slate-500">Mínimo 10 caracteres com letras e números. A pessoa pode trocar depois em “Minha conta”.</p></div>
          <div>
            <Label>Papel</Label>
            <Select name="role" className="w-full" defaultValue="VIEWER">
              {["MANAGER", "OPERATOR", "VIEWER"].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]} — {ROLE_HELP[r]}</option>)}
            </Select>
          </div>
          {invite.error && <p className="text-sm text-red-600">{(invite.error as Error).message}</p>}
          <Button type="submit" disabled={invite.isPending}>Adicionar</Button>
        </form>
      </Dialog>

      <Dialog open={!!pwdUser} onOpenChange={(v) => !v && setPwdUser(null)} title={`Redefinir senha — ${pwdUser?.name ?? ""}`}>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); patch.mutate({ id: pwdUser!.id, body: { password: new FormData(e.currentTarget).get("password") } }, { onSuccess: () => setPwdUser(null) }); }}>
          <div><Label>Nova senha</Label><Input name="password" type="password" minLength={10} required autoComplete="new-password" /></div>
          <p className="text-xs text-slate-500">Informe a nova senha à pessoa por um canal seguro.</p>
          <Button type="submit" disabled={patch.isPending}>Salvar</Button>
        </form>
      </Dialog>
    </div>
  );
}
