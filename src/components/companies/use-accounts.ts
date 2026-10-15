"use client";
/** Plano de contas da empresa (cache compartilhado entre as abas) + utilitários de seleção. */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";

export type Account = {
  id: string; parentId: string | null; code: string; name: string; level: number;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"; nature: "DEBIT" | "CREDIT";
  isAnalytic: boolean; balanceGroup: string | null; dreGroup: string | null; isActive: boolean; used: boolean;
};

export function useAccounts(companyId: string) {
  return useQuery({ queryKey: ["accounts", companyId], queryFn: () => api<Account[]>(`/api/companies/${companyId}/accounts`) });
}

export const accountLabel = (a: Pick<Account, "code" | "name">) => `${a.code} — ${a.name}`;

/** Aceita "1.1.1.01", "1.1.1.01 — Caixa" ou o nome exato. */
export function findAccount(list: Account[], text: string) {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const code = t.split(" ")[0];
  return list.find((a) => a.code === code) ?? list.find((a) => accountLabel(a).toLowerCase() === t) ?? list.find((a) => a.name.toLowerCase() === t);
}

/** Hoje e o 1º dia do mês, em AAAA-MM-DD (fuso local). */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function lastDay(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}
