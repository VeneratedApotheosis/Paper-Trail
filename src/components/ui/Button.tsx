import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

// Neumorphic variants: primary is the teal gradient; secondary is a soft raised
// chip; ghost presses in on hover.
const variants: Record<Variant, string> = {
  primary: "neu-accent",
  secondary: "neu-raised-sm text-teal-deep",
  ghost: "text-ink-muted hover:shadow-inset",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
