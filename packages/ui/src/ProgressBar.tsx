import type { ReactNode } from "react";

interface ProgressBarBase {
  value: number;
  max: number;
  /** Текст значения для читалок и справа от полосы («2 из 3»). */
  valueText?: string;
  /** Показать valueText справа от полосы. */
  showValue?: boolean;
  trailing?: ReactNode;
  className?: string;
}

export type ProgressBarProps = ProgressBarBase &
  (
    | {
        /** Подпись для читалок («Шаг заявки», «Пройдено уроков»). */
        label: string;
        decorative?: false;
      }
    | {
        label?: undefined;
        /**
         * Только картинка, без роли progressbar: внутри кнопки или ссылки, где значение уже сказано текстом рядом.
         * Разметка — строчные элементы (допустимы внутри кнопки).
         */
        decorative: true;
      }
  );

/**
 * Медовый прогресс-бар (prototype .bar): полностью скруглённый, с кромкой и бликом. Заливка — SVG с шириной
 * в атрибуте (строгая CSP не пропускает атрибуты style).
 */
export function ProgressBar({ value, max, label, valueText, showValue, trailing, className, decorative }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = (
    <svg className="tt-progress__fill" width={`${Number(pct.toFixed(2))}%`} height="100%" aria-hidden focusable="false">
      <rect className="tt-progress__shine" x={8} y={3} width="100%" height={3} rx={1.5} />
    </svg>
  );
  const cls = ["tt-progress", className].filter(Boolean).join(" ");
  if (decorative) {
    return (
      <span className={cls} aria-hidden>
        <span className="tt-progress__track">{fill}</span>
      </span>
    );
  }
  return (
    <div className={cls}>
      <div
        className="tt-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
      >
        {fill}
      </div>
      {showValue && valueText ? <span aria-hidden>{valueText}</span> : null}
      {trailing}
    </div>
  );
}
