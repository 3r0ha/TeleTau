import type { ReactNode } from "react";
import { CheckCircle, Info, Lightbulb, WarningCircle } from "@phosphor-icons/react/ssr";

export type AlertTone = "info" | "danger" | "honey" | "success";

const ICONS = { info: Info, danger: WarningCircle, honey: Lightbulb, success: CheckCircle } as const;

/**
 * Сообщение внутри экрана: подсказка (info, honey) или ошибка запроса (danger — role="alert", читается сразу).
 */
export function InlineAlert({ tone = "info", children, live }: { tone?: AlertTone; children: ReactNode; live?: boolean }) {
  const Icon = ICONS[tone];
  return (
    <div className={["tt-alert", tone !== "info" && `tt-alert--${tone}`].filter(Boolean).join(" ")} role={tone === "danger" || live ? "alert" : undefined}>
      <Icon weight="fill" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
