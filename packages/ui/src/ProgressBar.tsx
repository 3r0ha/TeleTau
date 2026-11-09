import type { ReactNode } from "react";

export interface ProgressBarProps {
  value: number;
  max: number;
  /** Подпись для читалок («Шаг заявки», «Пройдено уроков»). */
  label: string;
  /** Текст значения для читалок и справа от полосы («2 из 3»). */
  valueText?: string;
  /** Показать valueText справа от полосы. */
  showValue?: boolean;
  trailing?: ReactNode;
}

/**
 * Медовый прогресс-бар (prototype .bar): полностью скруглённый, с кромкой и бликом. Заливка — SVG с шириной
 * в атрибуте (строгая CSP не пропускает атрибуты style).
 */
export function ProgressBar({ value, max, label, valueText, showValue, trailing }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="tt-progress">
      <div
        className="tt-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
      >
        <svg className="tt-progress__fill" width={`${Number(pct.toFixed(2))}%`} height="100%" aria-hidden focusable="false">
          <rect className="tt-progress__shine" x={8} y={3} width="100%" height={3} rx={1.5} />
        </svg>
      </div>
      {showValue && valueText ? <span aria-hidden>{valueText}</span> : null}
      {trailing}
    </div>
  );
}
