"use client";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/fetcher";
import { ROLE_LABELS } from "@/lib/plans";
import { Avatar } from "@/components/ui/avatar";
import { AccountDialog } from "./account-dialog";

export function Topbar({ userName, role }: { userName: string; role: string }) {
  const [account, setAccount] = useState(false);
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b bg-white px-4">
      <button onClick={() => setAccount(true)} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100" title="Minha conta">
        <Avatar name={userName} />
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-none">{userName}</p>
          <p className="text-[11px] text-slate-500">{ROLE_LABELS[role] ?? role}</p>
        </div>
      </button>
      <AccountDialog open={account} onOpenChange={setAccount} />
      <button
        onClick={async () => {
          await api("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        aria-label="Sair"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
