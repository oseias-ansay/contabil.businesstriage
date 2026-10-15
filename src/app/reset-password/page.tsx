"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/fetcher";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done)
    return (
      <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
        Senha alterada. <Link href="/login" className="underline">Entrar agora</Link>
      </p>
    );
  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) return setError("As senhas não conferem");
        try {
          await api("/api/auth/reset", { method: "POST", json: { token, password: f.get("password") } });
          setDone(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div><Label>Nova senha</Label><Input name="password" type="password" minLength={10} required autoComplete="new-password" /></div>
      <div><Label>Repita a nova senha</Label><Input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></div>
      <p className="text-xs text-slate-500">Mínimo de 10 caracteres, com letras e números.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={!token}>Salvar nova senha</Button>
      {!token && <p className="text-sm text-red-600">Link inválido. Peça um novo em “Esqueci minha senha”.</p>}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Criar nova senha</h1>
        <Suspense><ResetForm /></Suspense>
      </div>
    </main>
  );
}
