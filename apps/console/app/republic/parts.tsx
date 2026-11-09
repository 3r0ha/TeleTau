"use client";

// Общие части раздела «Республика» (ADR 0023): плитки с крупными числами, столбчатая диаграмма по неделям,
// ячейки со скрытыми малыми группами и сортировка таблиц. Только агрегаты — никаких ников и номеров мест.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CaretDown, CaretUp, CaretUpDown } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";

export type Activity = Schema<"LearnerActivity">;
export type RepublicWeek = Schema<"RepublicWeek">;
export type Suppression = Schema<"Suppression">;

const nf = new Intl.NumberFormat("ru-RU");
export const num = (n: number) => nf.format(n);
const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const asOfFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yekaterinburg" });

/** «2 нояб.» из даты YYYY-MM-DD (дата учебных суток уже по Уфе). */
export const shortDate = (date: string) => dayMonth.format(new Date(`${date}T00:00:00Z`));
/** «02.11» — подпись столбца на узком экране. */
const numericDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
export const weekLabel = (w: Schema<"Week">) => `${shortDate(w.start)} – ${shortDate(w.end)}`;
export const asOfLabel = (iso: string) => asOfFmt.format(new Date(iso));

/** Склонение: 1 урок, 2 урока, 5 уроков. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

// ── плитки ──

export function Kpis({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="kpis" aria-label={label}>
      {children}
    </dl>
  );
}

/** Плитка: крупное число, подпись и пояснение мелко («из 63»). */
export function Kpi({ label, value, note, icon }: { label: string; value: ReactNode; note?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="kpi">
      <dt className="kpi__label">
        {icon ? (
          <span className="kpi__icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        {label}
      </dt>
      <dd className="kpi__value">
        {value}
        {note ? <span className="kpi__note">{note}</span> : null}
      </dd>
    </div>
  );
}

/** Число группы: «< 5» у малой группы, «скрыто» — при дополнительном скрытии. */
export function GroupNumber({ value, suppression }: { value?: number; suppression?: Suppression }) {
  if (suppression === "small_group") return <Hidden text="< 5" spoken="меньше пяти" />;
  if (suppression === "complementary") return <Hidden text="скрыто" spoken="скрыто" />;
  return <>{num(value ?? 0)}</>;
}

function Hidden({ text, spoken }: { text: string; spoken: string }) {
  return (
    <span className="hidden-num">
      <span aria-hidden>{text}</span>
      <span className="tt-visually-hidden">{spoken}</span>
    </span>
  );
}

export type ActivityKey = "students" | "activeWeek" | "lessonsWeek" | "lessonsTotal";

/** Ячейка с числом группы: у скрытой группы ученики — «< 5» или «скрыто», остальные числа — прочерк. */
export function ActivityCell({ activity, k }: { activity: Activity; k: ActivityKey }) {
  if (activity.suppression) {
    if (k === "students") return <GroupNumber suppression={activity.suppression} />;
    return <Hidden text="—" spoken="скрыто" />;
  }
  const value = activity[k] ?? 0;
  if (k === "activeWeek" && activity.students) {
    return (
      <span>
        {num(value)}
        <span className="table__sub">{Math.round((value / activity.students) * 100)} % учеников</span>
      </span>
    );
  }
  return <>{num(value)}</>;
}

/** Пояснение к скрытым числам — под таблицей, если в ней есть скрытые строки. */
export function SuppressionLegend({ threshold, kinds }: { threshold: number; kinds: ReadonlySet<Suppression> }) {
  if (kinds.size === 0) return null;
  return (
    <ul className="legend">
      {kinds.has("small_group") ? (
        <li>
          <b>&lt; {threshold}</b> — меньше {threshold} учеников, числа скрыты.
        </li>
      ) : null}
      {kinds.has("complementary") ? (
        <li>
          <b>скрыто</b> — чтобы малую группу не вычислили из итога.
        </li>
      ) : null}
    </ul>
  );
}

// ── сортировка таблиц ──

export interface Column<T> {
  key: string;
  label: string;
  /** Значение для сортировки; скрытые числа — null (всегда в конце). */
  sort: (row: T) => number | string | null;
  numeric?: boolean;
}

export function useSorted<T>(rows: readonly T[], columns: readonly Column<T>[], initial: { key: string; dir: "asc" | "desc" }) {
  const [order, setOrder] = useState(initial);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === order.key) ?? columns[0]!;
    const sign = order.dir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const a = col.sort(x);
      const b = col.sort(y);
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
      if (typeof a === "string" || typeof b === "string") return sign * String(a).localeCompare(String(b), "ru");
      return sign * (a - b);
    });
  }, [rows, columns, order]);
  const toggle = (key: string) =>
    setOrder((o) => (o.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: columns.find((c) => c.key === key)?.numeric ? "desc" : "asc" }));
  return { sorted, order, toggle };
}

/** Заголовок столбца — кнопка сортировки (aria-sort на th). */
export function SortHeader<T>({ column, order, onSort }: { column: Column<T>; order: { key: string; dir: "asc" | "desc" }; onSort: (key: string) => void }) {
  const active = order.key === column.key;
  const Icon = !active ? CaretUpDown : order.dir === "asc" ? CaretUp : CaretDown;
  return (
    <th scope="col" aria-sort={active ? (order.dir === "asc" ? "ascending" : "descending") : "none"} className={column.numeric ? "table__num" : undefined}>
      <button type="button" className="sort-btn" onClick={() => onSort(column.key)}>
        {column.label}
        <Icon weight="bold" aria-hidden />
      </button>
    </th>
  );
}

// ── динамика по неделям ──

type Measure = "lessons" | "active";
const MEASURES: { key: Measure; label: string; caption: (n: number) => string }[] = [
  { key: "lessons", label: "Уроки", caption: (n) => `${num(n)} ${plural(n, "урок", "урока", "уроков")}` },
  { key: "active", label: "Занимались", caption: (n) => `занимались ${num(n)} ${plural(n, "ученик", "ученика", "учеников")}` },
];

const H = 220;
const PAD = { top: 28, right: 8, bottom: 34, left: 44 };
/** Столбец не шире 24 px, концы данных скруглены на 4 px, у основания — прямо. */
const BAR = 24;
const R = 4;

/** «Красивая» верхняя граница оси: 1, 2, 2,5 или 5 × 10ⁿ. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function columnPath(x: number, y: number, w: number, base: number): string {
  const r = Math.min(R, (base - y) / 2, w / 2);
  if (base - y < 1) return "";
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/**
 * Столбчатая диаграмма по неделям: одна мера за раз (уроки или занимавшиеся), текущая неделя — штриховкой (она ещё
 * идёт). Подписи — только у текущей недели и у максимума; остальные числа — при наведении и фокусе (строка над
 * диаграммой) и в таблице под ней. SVG без атрибутов style — строгая CSP.
 */
export function WeeksChart({ weeks, title }: { weeks: readonly RepublicWeek[]; title: string }) {
  // Идентификатор для url(#…) и id: только буквы, цифры, «-» и «_».
  const id = `wc${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [measure, setMeasure] = useState<Measure>("lessons");
  // Наведение и фокус клавиатуры: пока столбец в фокусе, строка над диаграммой показывает его.
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const focus = focused ?? hover;
  // Ширина рисунка — по ширине панели (1 единица viewBox = 1 px): подписи не мельчают на телефоне.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => entry && setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 520;
  const values = weeks.map((w) => (measure === "lessons" ? w.lessons : w.active));
  const max = niceMax(Math.max(0, ...values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const slot = plotW / Math.max(1, weeks.length);
  const barW = Math.min(BAR, slot * 0.6);
  const yOf = (v: number) => base - (v / max) * plotH;
  const peak = values.indexOf(Math.max(...values));
  const last = weeks.length - 1;
  const m = MEASURES.find((x) => x.key === measure)!;
  const shown = focus ?? last;
  const ticks = [0, max / 2, max];

  return (
    <section className="chart" aria-labelledby={`${id}-title`}>
      <header className="chart__head">
        <div className="tt-stack tt-stack--tight">
          <h2 className="tt-title3" id={`${id}-title`}>
            {title}
          </h2>
          <p className="chart__readout" aria-live="polite">
            {weeks[shown] ? (
              <>
                <b>{m.caption(values[shown] ?? 0)}</b> · {shown === last ? "эта неделя, " : ""}
                {weekLabel(weeks[shown]!.week)}
              </>
            ) : null}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Что показать">
          {MEASURES.map((x) => (
            <button key={x.key} type="button" aria-pressed={measure === x.key} onClick={() => setMeasure(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
      </header>
      <div ref={box} className="chart__box">
      <svg className="chart__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-table`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
            <rect className="chart__hatch-bg" width={6} height={6} />
            <line className="chart__hatch" x1={0} y1={0} x2={0} y2={6} />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart__grid" x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} />
            <text className="chart__tick" x={PAD.left - 8} y={yOf(t)} dy="0.32em" textAnchor="end">
              {num(t)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const v = values[i] ?? 0;
          const cx = PAD.left + slot * i + slot / 2;
          const x = cx - barW / 2;
          const y = yOf(v);
          const current = i === last;
          const labelled = i === last || (i === peak && v > 0);
          return (
            <g
              key={w.week.start}
              className={focus === i ? "chart__col chart__col--focus" : "chart__col"}
              tabIndex={0}
              role="img"
              aria-label={`${current ? "Эта неделя" : "Неделя"} ${weekLabel(w.week)}: ${m.caption(v)}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setFocused(i)}
              onBlur={() => setFocused(null)}
            >
              <rect className="chart__hit" x={PAD.left + slot * i} y={PAD.top - 20} width={slot} height={plotH + 20} />
              <path className={current ? "chart__bar chart__bar--current" : "chart__bar"} d={columnPath(x, y, barW, base)} fill={current ? `url(#${id}-hatch)` : undefined} />
              {labelled ? (
                <text className="chart__value" x={cx} y={y - 8} textAnchor="middle">
                  {num(v)}
                </text>
              ) : null}
              {/* На узком экране — подпись через неделю (от текущей), иначе даты наезжают друг на друга. */}
              {!narrow || (last - i) % 2 === 0 ? (
                <text className="chart__x" x={cx} y={base + 20} textAnchor="middle">
                  {narrow ? numericDate(w.week.start) : current ? "эта неделя" : shortDate(w.week.start)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line className="chart__axis" x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} />
      </svg>
      </div>
      <details className="chart__table">
        <summary>Числа по неделям</summary>
        <table className="table table--dense" id={`${id}-table`}>
          <caption className="tt-visually-hidden">{title}: по неделям</caption>
          <thead>
            <tr>
              <th scope="col">Неделя</th>
              <th scope="col" className="table__num">
                Уроков
              </th>
              <th scope="col" className="table__num">
                Занимались
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={w.week.start}>
                <td>
                  {weekLabel(w.week)}
                  {i === last ? <span className="table__sub">идёт сейчас</span> : null}
                </td>
                <td className="table__num">{num(w.lessons)}</td>
                <td className="table__num">{num(w.active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
