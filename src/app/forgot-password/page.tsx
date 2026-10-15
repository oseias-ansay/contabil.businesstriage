"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/fetcher";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">Esqueci minha senha</h1>
        {sent ? (
          <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
            Se o e-mail estiver cadastrado, você receberá em instantes um link para criar uma nova senha (válido por 1 hora).
          </p>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              await api("/api/auth/forgot", { method: "POST", json: { email: new FormData(e.currentTarget).get("email") } }).catch(() => null);
              setSent(true);
              setLoading(false);
            }}
          >
            <p className="text-sm text-slate-500">Informe seu e-mail de acesso. Enviaremos um link para redefinir a senha.</p>
            <div><Label htmlFor="email">E-mail</Label><Input id="email" name="email" type="email" required /></div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Enviando…" : "Enviar link"}</Button>
          </form>
        )}
        <Link href="/login" className="mt-6 block text-center text-sm text-primary underline">Voltar ao login</Link>
      </div>
    </main>
  );
}
