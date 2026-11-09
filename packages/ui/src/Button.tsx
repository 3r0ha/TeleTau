import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { CircleNotch } from "@phosphor-icons/react/ssr";

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "violet";

interface ButtonLook {
  variant?: ButtonVariant;
  /** На всю ширину контейнера (как в прототипе на телефоне). */
  block?: boolean;
  /** 44 px вместо 52 px — для панелей инструментов и строк таблиц. */
  small?: boolean;
}

/** Класс кнопки с «губой» — для ссылок и других элементов, которые должны выглядеть как кнопка. */
export function buttonClass({ variant = "primary", block, small }: ButtonLook = {}, extra?: string): string {
  return ["tt-btn", variant !== "primary" && `tt-btn--${variant}`, block && "tt-btn--block", small && "tt-btn--small", extra]
    .filter(Boolean)
    .join(" ");
}

export interface ButtonProps extends ButtonLook, ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  /** Идёт действие: кнопка недоступна, показывает индикатор, для читалок — aria-busy. */
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * Кнопка действия с «губой» (prototype .btn): на ярких заливках — тёмный текст (text.onFill), белый — только на фиолетовой.
 * Одна основная кнопка на экран; вторичная — белая с границей.
 */
export function Button({ variant, block, small, icon, loading, disabled, children, className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass({ variant, block, small }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <CircleNotch weight="bold" className="tt-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends ButtonLook, Omit<ComponentProps<typeof Link>, "className"> {
  icon?: ReactNode;
  className?: string;
}

/** Ссылка (переход Next.js), которая выглядит как кнопка. */
export function ButtonLink({ variant, block, small, icon, children, className, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={buttonClass({ variant, block, small }, className)}>
      {icon}
      {children}
    </Link>
  );
}

export interface LinkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "accent" | "danger" | "neutral";
  icon?: ReactNode;
  /**
   * Идёт действие («Показать ещё» грузит страницу): нажатие ничего не делает, вместо значка — индикатор, для читалок —
   * aria-busy и aria-disabled. Фокус остаётся на кнопке: disabled выбросил бы его на начало страницы.
   */
  loading?: boolean;
}

/** Текстовая кнопка (prototype .link-btn): «Изменить адрес», «Выйти из урока», «Показать ещё». */
export function LinkButton({ tone = "accent", icon, loading, className, children, type = "button", onClick, ...rest }: LinkButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={["tt-link-btn", tone !== "accent" && `tt-link-btn--${tone}`, className].filter(Boolean).join(" ")}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest["aria-disabled"]}
      onClick={loading ? (e) => e.preventDefault() : onClick}
    >
      {loading ? <CircleNotch weight="bold" className="tt-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Текстовая ссылка того же вида, что LinkButton. */
export function TextLink({
  tone = "accent",
  className,
  ...rest
}: Omit<ComponentProps<typeof Link>, "className"> & { tone?: "accent" | "danger" | "neutral"; className?: string }) {
  return <Link {...rest} className={["tt-link-btn", tone !== "accent" && `tt-link-btn--${tone}`, className].filter(Boolean).join(" ")} />;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Подпись для читалок экрана — обязательна: на кнопке только значок. */
  label: string;
  icon: ReactNode;
  framed?: boolean;
}

/** Иконочная кнопка 44×44 (prototype .icon-btn). */
export function IconButton({ label, icon, framed, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={["tt-icon-btn", framed && "tt-icon-btn--framed", className].filter(Boolean).join(" ")}
    >
      {icon}
    </button>
  );
}

export type { AnchorHTMLAttributes };
