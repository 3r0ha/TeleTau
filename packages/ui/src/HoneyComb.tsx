import { hexPath } from "./hex";

export type CombCell = "honey" | "nectar" | "empty";

export interface HoneyCombProps {
  total: number;
  /** Ячейки, полные мёда (созрело, сделано). */
  filled: number;
  /** Ячейки с нектаром — ещё созревают (ждут голосов учителей и взрослых, текущее место). */
  nectar?: number;
  /** Ячеек в ряду (по умолчанию 12 — ряд карточки на телефоне). */
  perRow?: number;
  /** Подпись для читалок; без неё соты декоративные (смысл передаёт текст рядом). */
  label?: string;
}

// Ячейка 30×26 со скруглением 4; соседние заходят друг на друга на 6 px, нечётные опущены на полвысоты (prototype comb).
const CW = 30;
const CH = 26;
const STEP = CW - 6;
const DROP = CH / 2;
const ROW = CH + DROP + 4;
const STROKE = 2;

/**
 * Соты (prototype comb): ряд шестиугольных ячеек зигзагом — мёд, нектар и пустые. Квест класса, «Мой вклад в словарь»,
 * пройденные места. Одна SVG с позициями в атрибутах (без style — строгая CSP).
 */
export function HoneyComb({ total, filled, nectar = 0, perRow = 12, label }: HoneyCombProps) {
  const n = Math.max(0, Math.floor(total));
  const cols = Math.max(1, Math.min(perRow, n));
  const rows = Math.max(1, Math.ceil(n / cols));
  const width = CW + (cols - 1) * STEP;
  const height = rows * ROW - 4;
  const cells = Array.from({ length: n }, (_, i): CombCell => (i < filled ? "honey" : i < filled + nectar ? "nectar" : "empty"));
  return (
    <svg
      className="tt-comb"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {cells.map((kind, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * STEP;
        const y = row * ROW + (col % 2 ? DROP : 0);
        // Обводка не увеличивает ячейку: контур сдвинут внутрь на половину толщины.
        const inset = kind === "honey" ? 0 : STROKE / 2;
        return <path key={i} className={`tt-comb__cell tt-comb__cell--${kind}`} d={hexPath(CW - inset * 2, CH - inset * 2, 4, x + inset, y + inset)} />;
      })}
    </svg>
  );
}
