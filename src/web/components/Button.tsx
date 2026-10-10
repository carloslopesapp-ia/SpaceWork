import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

const BASE =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60";
// A cor do anel de foco vive em cada variante: o botão de perigo tem o anel vermelho.
const VARIANTS = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-indigo-300",
  danger: "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-300",
};

/** As classes de um botão, para uma ligação (`<a>`) com o aspeto de botão. */
export function buttonClass(variant: NonNullable<ButtonProps["variant"]> = "primary", className = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${className}`;
}

export function Button({ variant = "primary", type = "button", className = "", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
