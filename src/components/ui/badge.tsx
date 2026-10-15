import { cn } from "@/lib/utils";

export function Badge({ children, color, className }: { children: React.ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", !color && "bg-slate-100 text-slate-700", className)}
      style={color ? { backgroundColor: `${color}1A`, color } : undefined}
    >
      {children}
    </span>
  );
}
