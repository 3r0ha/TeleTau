import type { ReactNode } from "react";

/** Ряд плиток-статистики — список «название — значение» (<dl>). */
export function StatTiles({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className="tt-stiles" aria-label={label}>
      {children}
    </dl>
  );
}

/**
 * Плитка-статистика (prototype .stile): медовая шапка с названием и крупное значение. Используется внутри StatTiles.
 */
export function StatTile({ label, value, icon, className }: { label: ReactNode; value: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={["tt-stile", className].filter(Boolean).join(" ")}>
      <dt className="tt-stile__label">{label}</dt>
      <dd className="tt-stile__value">
        {icon ? (
          <span className="tt-stile__icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        {value}
      </dd>
    </div>
  );
}
