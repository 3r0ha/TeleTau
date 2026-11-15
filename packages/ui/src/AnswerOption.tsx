"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, X } from "@phosphor-icons/react/ssr";
import { useUiStrings } from "./UiStrings";

export type OptionTone = "honey" | "violet";

export interface AnswerOptionItem<V extends string> {
  value: V;
  label: ReactNode;
  /** Метка слева: номер (1–4) или буква (A, B). Она же — клавиша выбора (aria-keyshortcuts). */
  mark?: string;
  /** Клавиша выбора, если она не совпадает с меткой (у «Оба подходят» метки нет, клавиша — 3). */
  shortcut?: string;
  /** lang текста варианта: башкирский — "ba". */
  lang?: string;
  /** card — крупная плитка варианта, pill — короткая кнопка-чип под плитками («Оба подходят», «Не знаю»). */
  look?: "card" | "pill";
}

export interface AnswerOptionsProps<V extends string> {
  /** Подпись группы для читалок («Варианты ответа»). */
  label: string;
  options: AnswerOptionItem<V>[];
  value: V | null;
  onChange: (value: V) => void;
  tone?: OptionTone;
  /** Ответ проверен — выбор больше не меняется. */
  disabled?: boolean;
  /**
   * После проверки: верный вариант — ok (зелёный, галочка), выбранный неверный — bad (коралл, крестик). Статус — не
   * только цветом: значок вместо номера и текст для читалки.
   */
  verdicts?: Partial<Record<V, "ok" | "bad">>;
}

/**
 * Варианты ответа (prototype .option и .variant/.duel-alt): радиогруппа из плиток с меткой-номером. Выбор — не только
 * цветом: граница и «губа» темнее, метка заливается. Стрелки переносят выбор, Tab входит в группу на выбранный
 * вариант (roving tabindex); клавиши 1–4 обрабатывает экран упражнения.
 */
export function AnswerOptions<V extends string>({ label, options, value, onChange, tone = "honey", disabled, verdicts }: AnswerOptionsProps<V>) {
  const s = useUiStrings();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const focusable = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const from = Math.max(0, refs.current.findIndex((el) => el === document.activeElement));
    const next = (from + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  const render = (o: AnswerOptionItem<V>, i: number) => {
    const selected = o.value === value;
    const pill = o.look === "pill";
    const verdict = verdicts?.[o.value];
    return (
      <button
        key={o.value}
        ref={(el) => {
          refs.current[i] = el;
        }}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={o.shortcut ?? o.mark}
        tabIndex={i === focusable ? 0 : -1}
        className={[pill ? "tt-pill" : "tt-option", `tt-option--${tone}`, verdict && `tt-option--${verdict}`].filter(Boolean).join(" ")}
        onClick={() => {
          if (!disabled) onChange(o.value);
        }}
      >
        {!pill && o.mark ? (
          <span className="tt-option__mark" aria-hidden>
            {verdict === "ok" ? <Check weight="bold" /> : verdict === "bad" ? <X weight="bold" /> : o.mark}
          </span>
        ) : null}
        <span className="tt-option__text" lang={o.lang}>
          {o.label}
        </span>
        {verdict ? <span className="tt-visually-hidden">{`, ${verdict === "ok" ? s.answerOk : s.answerNo}`}</span> : null}
      </button>
    );
  };

  const cards = options.map((o, i) => [o, i] as const).filter(([o]) => o.look !== "pill");
  const pills = options.map((o, i) => [o, i] as const).filter(([o]) => o.look === "pill");
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className="tt-options" onKeyDown={onKeyDown}>
      <div className="tt-options__cards">{cards.map(([o, i]) => render(o, i))}</div>
      {pills.length ? <div className="tt-options__pills">{pills.map(([o, i]) => render(o, i))}</div> : null}
    </div>
  );
}
