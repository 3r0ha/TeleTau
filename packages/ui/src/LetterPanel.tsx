"use client";

import type { PointerEvent, MouseEvent } from "react";
import { useUiStrings } from "./UiStrings";

/**
 * Особые буквы башкирского алфавита в порядке прототипа: ә ө ү ғ ҡ ң ҙ ҫ һ. Только правильные кодовые точки
 * (CLAUDE.md, правило 7): U+04D9, U+04E9, U+04AF, U+0493, U+04A1, U+04A3, U+0499, U+04AB, U+04BB.
 */
export const BASHKIR_LETTERS = ["ә", "ө", "ү", "ғ", "ҡ", "ң", "ҙ", "ҫ", "һ"] as const;

export interface LetterPanelProps {
  /** Буквы панели (контракт: FreeInputExercise.letters); по умолчанию — все девять особых букв. */
  letters?: readonly string[];
  /** Вставить букву в поле ввода (в позицию курсора — забота экрана). */
  onInsert: (letter: string) => void;
  disabled?: boolean;
  /** Подсказка под панелью (по умолчанию нет: кнопки с буквами понятны без слов). */
  hint?: string;
}

// Кнопка не забирает фокус у поля: курсор остаётся на месте, а экранная клавиатура телефона не закрывается.
const keepFocus = (e: PointerEvent | MouseEvent) => e.preventDefault();

/**
 * Панель башкирских букв над клавиатурой (docs/05 §8, п. 2; prototype .letters): без неё ребёнок на телефоне без
 * башкирской раскладки не введёт ҡ, ғ, ҙ. В режиме «Пчёлка» кнопки 56 px и переносятся в два ряда.
 */
export function LetterPanel({ letters = BASHKIR_LETTERS, onInsert, disabled, hint }: LetterPanelProps) {
  const s = useUiStrings();
  return (
    <div className="tt-letters">
      <div className="tt-letters__grid" role="group" aria-label={s.letters}>
        {letters.map((l) => (
          <button
            key={l}
            type="button"
            className="tt-letter"
            lang="ba"
            disabled={disabled}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => onInsert(l)}
          >
            {l}
          </button>
        ))}
      </div>
      {hint ? <p className="tt-letters__hint">{hint}</p> : null}
    </div>
  );
}
