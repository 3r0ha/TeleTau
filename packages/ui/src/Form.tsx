"use client";

import { useEffect, useMemo, useRef, useState, type FormHTMLAttributes, type ReactNode } from "react";

/**
 * Запрос «перенести фокус на первое неверное поле» (WCAG 3.3.1 и 4.1.3). Держит его компонент со состоянием
 * ошибок (страница, диалог): форма может появиться позже — например, ошибку поля шага 1 сервер вернул на шаге 3.
 */
export interface InvalidFocus {
  /** Вызвать вместе с установкой ошибок полей: после перерисовки фокус перейдёт на первое поле с aria-invalid. */
  request(): void;
  /** Запрос ещё не выполнен (читает <Form>). */
  readonly pending: { current: boolean };
}

export function useInvalidFocus(): InvalidFocus {
  const pending = useRef(false);
  // Перерисовка, даже если текст ошибки не изменился (повторная отправка с той же ошибкой).
  const [, setAttempt] = useState(0);
  return useMemo(
    () => ({
      pending,
      request() {
        pending.current = true;
        setAttempt((n) => n + 1);
      },
    }),
    [],
  );
}

/** Текст ошибки поля — из элемента ошибки, на который ссылается aria-describedby (TextField, TextArea). */
function errorText(field: HTMLElement): string {
  const described = (field.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id) : null))
    .filter((el): el is HTMLElement => el !== null);
  const error = described.find((el) => el.classList.contains("tt-field__error")) ?? described[0];
  return (error?.textContent ?? "").trim();
}

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit" | "noValidate"> {
  /** Отправка формы (событие уже отменено: страница не перезагружается). */
  onSubmit: () => void;
  /** Запрос фокуса на неверное поле из useInvalidFocus(). */
  invalidFocus?: InvalidFocus;
  children?: ReactNode;
}

/**
 * Форма с проверкой полей на клиенте (noValidate: браузерные всплывающие подсказки не читаются одинаково и не
 * переводятся). После неудачной проверки — своей или ответа API `validation_failed` — фокус переходит на первое поле
 * с aria-invalid: читалка экрана называет поле, «недопустимое значение» и текст ошибки (aria-describedby).
 * Если фокус уже на этом поле (Enter в поле), повторный focus() читалка не объявит — ошибку читает живая область формы.
 */
export function Form({ onSubmit, invalidFocus, children, ...rest }: FormProps) {
  const ref = useRef<HTMLFormElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // После каждой перерисовки: есть запрос и в форме есть неверное поле — выполнить запрос.
  useEffect(() => {
    if (!invalidFocus?.pending.current) return;
    const field = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    invalidFocus.pending.current = false;
    clearTimeout(timer.current);
    if (document.activeElement === field) {
      // Очистить и записать заново: живая область объявляет изменение, а тот же текст — не изменение.
      const text = errorText(field);
      setAnnouncement("");
      timer.current = setTimeout(() => setAnnouncement(text), 100);
    } else {
      setAnnouncement("");
      field.focus();
    }
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <form
      ref={ref}
      noValidate
      {...rest}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <p className="tt-visually-hidden" aria-live="assertive" aria-atomic="true">
        {announcement}
      </p>
    </form>
  );
}
