import { cn, initials } from "@/lib/utils";

export function Avatar({ name, src, size = 28, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  if (src) return <img src={src} alt={name ?? ""} width={size} height={size} className={cn("rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  return (
    <span
      title={name ?? undefined}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-secondary/15 font-semibold text-secondary", className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {name ? initials(name) : "?"}
    </span>
  );
}
