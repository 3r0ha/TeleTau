"use client";

import { Fragment, useEffect, useId, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react/ssr";
import { fillUi } from "./strings";
import { useUiStrings } from "./UiStrings";

export interface CodeInputProps {
  /** Число ячеек: 4 — код из письма (0000), 6 — TOTP или код класса. */
  length: number;
  value: string;
  onChange: (value: string) => void;
  /** Вызывается, когда заполнены все ячейки (в том числе вставкой или автозаполнением). */
  onComplete?: (value: string) => void;
  /** Подпись группы для читалок и зрячих. */
  label: string;
  /** Подпись видна над ячейками (по умолчанию — только для читалок: заголовок экрана уже её содержит). */
  showLabel?: boolean;
  /** digits — только цифры; code — буквы и цифры (код класса), верхний регистр. */
  charset?: "digits" | "code";
  /**
   * Нормализация вставленного или набранного текста (например, normalizeCodeInput из @teletau/auth-codes
   * для кода класса: кириллические двойники, O→0, I/L→1). По умолчанию — убрать всё, кроме допустимых символов.
   */
  normalize?: (raw: string) => string;
  /** Разделитель после каждых N ячеек (код класса ABC-DEF — 3). */
  groupSize?: number;
  error?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
}

const DIGITS = /[^0-9]/g;
const CODE = /[^0-9A-Z]/g;

/**
 * Ввод кода по ячейкам: автопереход вперёд, Backspace — назад, стрелки, вставка всего кода в любую ячейку,
 * автозаполнение одноразового кода (autocomplete="one-time-code" на первой ячейке).
 */
export function CodeInput({
  length,
  value,
  onChange,
  onComplete,
  label,
  showLabel,
  charset = "digits",
  normalize,
  groupSize,
  error,
  hint,
  disabled,
  autoFocus,
  compact,
}: CodeInputProps) {
  const s = useUiStrings();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // Последнее значение — сразу, не дожидаясь перерисовки: быстрый ввод и автозаполнение не теряют символы.
  const valueRef = useRef(value);
  valueRef.current = value;
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const clean = (raw: string) => {
    const upper = charset === "code" ? raw.toUpperCase() : raw;
    const normalized = normalize ? normalize(upper) : upper;
    return normalized.replace(charset === "digits" ? DIGITS : CODE, "");
  };
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  // После ошибки (поле очищено, ячейки снова доступны) — фокус обратно в ячейки, чтобы сразу ввести код заново.
  useEffect(() => {
    if (error && !disabled) refs.current[Math.min(valueRef.current.length, length - 1)]?.focus();
  }, [error, disabled, length]);

  const commit = (next: string, focusIndex: number) => {
    const limited = next.slice(0, length);
    valueRef.current = limited;
    onChange(limited);
    refs.current[Math.min(focusIndex, length - 1)]?.focus();
    if (limited.length === length) onComplete?.(limited);
  };

  /** Вставка с позиции i: заменяет символы, начиная с i. */
  const insertAt = (i: number, text: string) => {
    const incoming = clean(text);
    if (!incoming) return;
    const before = valueRef.current.slice(0, i);
    const next = (before + incoming).slice(0, length);
    commit(next, next.length);
  };

  const onInput = (i: number, raw: string) => {
    const current = valueRef.current;
    if (raw === "") {
      commit(current.slice(0, i) + current.slice(i + 1), i);
      return;
    }
    // В ячейке был символ — новый набранный символ заменяет его (берём последний введённый).
    const typed = raw.length > 1 && current[i] && raw.startsWith(current[i]!) ? raw.slice(1) : raw;
    insertAt(i, typed);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    const current = valueRef.current;
    if (e.key === "Backspace" && !current[i] && i > 0) {
      e.preventDefault();
      commit(current.slice(0, i - 1) + current.slice(i), i - 1);
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < length - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    insertAt(i, e.clipboardData.getData("text"));
  };

  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="tt-field">
      <span id={labelId} className={showLabel ? "tt-field__label" : "tt-visually-hidden"}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={["tt-code", compact && "tt-code--compact"].filter(Boolean).join(" ")}
      >
        {chars.map((ch, i) => (
          <Fragment key={i}>
            {groupSize && i > 0 && i % groupSize === 0 ? <span className="tt-code__dash" aria-hidden /> : null}
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              className="tt-code__cell"
              value={ch}
              data-filled={ch ? "true" : undefined}
              onChange={(e) => onInput(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={(e) => onPaste(i, e)}
              onFocus={(e) => e.target.select()}
              inputMode={charset === "digits" ? "numeric" : "text"}
              autoComplete={i === 0 && charset === "digits" ? "one-time-code" : "off"}
              autoCapitalize={charset === "code" ? "characters" : "off"}
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint={i === length - 1 ? "done" : "next"}
              aria-label={fillUi(s.codeCell, { label, n: i + 1, length })}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              autoFocus={autoFocus && i === Math.min(value.length, length - 1)}
            />
          </Fragment>
        ))}
      </div>
      {error ? (
        <p className="tt-field__error tt-field__error--center" id={errorId}>
          <WarningCircle weight="fill" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p className="tt-field__hint tt-field__hint--center" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
