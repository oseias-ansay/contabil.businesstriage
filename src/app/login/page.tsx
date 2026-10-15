import { getCurrentTenant } from "@/lib/tenant";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const t = await getCurrentTenant();
  // Subdomínio/domínio que não pertence a nenhum cliente: não revela nada
  if (!t) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Endereço não encontrado</h1>
          <p className="mt-2 text-sm text-slate-500">Confira o link de acesso enviado pela sua empresa.</p>
        </div>
      </main>
    );
  }
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        {t.logoUrl ? <img src={t.logoUrl} alt={t.name} className="h-10 w-auto object-contain" /> : <span className="text-xl font-bold">{t.name}</span>}
        <div>
          <h1 className="text-4xl font-semibold leading-tight">{t.loginHeadline ?? "Seus números, em ordem."}</h1>
          <p className="mt-4 max-w-md opacity-80">Plano de contas, lançamentos, balancete, DRE e balanço gerenciais em um só lugar.</p>
        </div>
        <span className="text-xs opacity-60">© {new Date().getFullYear()} {t.name}</span>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="mb-1 text-2xl font-semibold">Entrar</h2>
          <p className="mb-6 text-sm text-slate-500">Acesse a contabilidade gerencial {t.name}</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
