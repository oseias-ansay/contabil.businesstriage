import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/90",
  outline: "border border-slate-300 bg-white hover:bg-slate-50",
  ghost: "hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "icon";
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "primary", size = "md", asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3" : size === "icon" ? "h-9 w-9" : "h-10 px-4",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";
