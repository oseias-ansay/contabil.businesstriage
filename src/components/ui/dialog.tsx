"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Modal centralizado ou painel lateral (side="right"). */
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  side,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
  side?: "right";
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <D.Content
          className={cn(
            "fixed z-50 flex flex-col bg-white shadow-xl outline-none",
            side === "right" ? "inset-y-0 right-0 w-full max-w-2xl" : "left-1/2 top-1/2 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl",
            className,
          )}
        >
          <div className="flex items-center justify-between border-b px-5 py-3">
            <D.Title className="font-semibold">{title}</D.Title>
            <D.Close className="rounded p-1 hover:bg-slate-100" aria-label="Fechar">
              <X size={18} />
            </D.Close>
          </div>
          <D.Description className="sr-only">{title}</D.Description>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
