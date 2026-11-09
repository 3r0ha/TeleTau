import type { HTMLAttributes, ReactNode } from "react";

export type ChipTone = "honey" | "green" | "water" | "coral" | "violet" | "neutral" | "solid";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: ReactNode;
}

/**
 * Чип-метка (prototype .chip): полностью скруглённый, Nunito 800.
 * Цвет — только вместе с текстом или значком: статус не передаётся одним цветом.
 */
export function Chip({ tone = "honey", icon, className, children, ...rest }: ChipProps) {
  return (
    <span {...rest} className={["tt-chip", tone !== "honey" && `tt-chip--${tone}`, className].filter(Boolean).join(" ")}>
      {icon}
      {children}
    </span>
  );
}
