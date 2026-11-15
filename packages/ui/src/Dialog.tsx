"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { X } from "@phosphor-icons/react/ssr";
import type { StaticImageData } from "next/image";
import { IconButton } from "./Button";
import { openSheetEntry } from "./sheetHistory";
import { useUiStrings } from "./UiStrings";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Кнопки внизу (основная — первой). */
  actions?: ReactNode;
  /** Иллюстрация над заголовком (prototype .dialog img: пчела «выглядывает» из листа). */
  art?: StaticImageData;
  /**
   * sheet — лист снизу на телефоне, карточка по центру на широком экране;
   * board — во весь экран медовым фоном (код класса на доску).
   */
  variant?: "sheet" | "board";
  /** Шире на компьютере (таблицы, списки заявок). */
  wide?: boolean;
  /** Выравнивание заголовка и текста по центру (диалоги-подтверждения с иллюстрацией). */
  centered?: boolean;
  /** Что получает фокус при открытии (по умолчанию — первый интерактивный элемент). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Скрыть кнопку-крестик (когда закрытие — одна из кнопок actions). */
  hideClose?: boolean;
  closeLabel?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Модальный лист/диалог на нативном <dialog> (showModal): остальная страница инертна, Esc закрывает,
 * фокус переходит внутрь и возвращается на кнопку, которая открыла диалог. Tab не выходит за пределы диалога.
 * Открытый лист — своя запись истории (sheetHistory.ts): «Назад» браузера и Android закрывает лист, а не уводит
 * со страницы. Переход на другую страницу из открытого листа — router.replace, не закрывая лист (см. sheetHistory.ts).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  art,
  variant = "sheet",
  wide,
  centered,
  initialFocusRef,
  hideClose,
  closeLabel,
}: DialogProps) {
  const s = useUiStrings();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      if (initialFocusRef?.current) initialFocusRef.current.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initialFocusRef]);

  // «Назад» при открытом листе закрывает лист; закрытие листа убирает его запись из истории.
  useEffect(() => {
    if (!open) return;
    return openSheetEntry(() => onCloseRef.current());
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const classes = [
    "tt-dialog",
    variant === "board" && "tt-dialog--board",
    wide && "tt-dialog--wide",
    centered && "tt-dialog--center",
    art && "tt-dialog--with-art",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <dialog
      ref={ref}
      className={classes}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // Нажатие на затемнение (сам <dialog>, а не его содержимое) закрывает лист.
        if (e.target === e.currentTarget && variant !== "board") onClose();
      }}
    >
      {open ? (
        <div className="tt-dialog__panel">
          {art ? <img className="tt-dialog__art" src={art.src} width={art.width} height={art.height} alt="" /> : null}
          <div className="tt-dialog__head">
            <h2 className="tt-dialog__title" id={titleId}>
              {title}
            </h2>
            {hideClose ? null : <IconButton label={closeLabel ?? s.close} icon={<X weight="bold" />} onClick={onClose} />}
          </div>
          {description ? (
            <p className="tt-dialog__desc" id={descId}>
              {description}
            </p>
          ) : null}
          {children}
          {actions ? <div className="tt-dialog__actions">{actions}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
