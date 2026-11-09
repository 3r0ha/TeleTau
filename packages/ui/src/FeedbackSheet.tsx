"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Check, Drop, Lightbulb, X } from "@phosphor-icons/react/ssr";
import type { StaticImageData } from "next/image";
import { Button, type ButtonVariant } from "./Button";

/** ok — верно, bad — неверно, almost — «почти» (не та буква), voted — голос в дуэли учтён. */
export type FeedbackTone = "ok" | "bad" | "almost" | "voted";

const LOOK: Record<FeedbackTone, { button: ButtonVariant; icon: ReactNode }> = {
  ok: { button: "success", icon: <Check weight="bold" /> },
  bad: { button: "danger", icon: <X weight="bold" /> },
  almost: { button: "primary", icon: <Lightbulb weight="bold" /> },
  voted: { button: "violet", icon: null },
};

export interface FeedbackSheetProps {
  tone: FeedbackTone;
  title: ReactNode;
  children?: ReactNode;
  actionLabel: string;
  onAction: () => void;
  /** Иллюстрация слева от текста (лист «Голос учтён» — радостная пчела) вместо значка в кружке. */
  art?: StaticImageData;
  /** Перенести фокус на кнопку при появлении (по умолчанию — да): Enter и пробел сразу продолжают урок. */
  autoFocus?: boolean;
}

const DROPS = 6;

/** «Верно»: вспышка за галочкой и брызги мёда во все стороны (CSS, токены burst и fall; при «Уменьшении движения» — нет). */
function HoneyBurst() {
  return (
    <span className="tt-burst">
      {Array.from({ length: DROPS }, (_, i) => (
        <Drop key={i} weight="fill" className={`tt-burst__drop tt-burst__drop--${i + 1}`} />
      ))}
    </span>
  );
}

/**
 * Лист обратной связи под упражнением (prototype .sheet): поднимается снизу на место кнопки «Проверить». Цвет — вместе
 * со значком и заголовком (статус не передаётся одним цветом). Фокус — на кнопке «Дальше»; читалка объявляет вердикт
 * через aria-describedby кнопки.
 */
export function FeedbackSheet({ tone, title, children, actionLabel, onAction, art, autoFocus = true }: FeedbackSheetProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (autoFocus) button.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const look = LOOK[tone];
  const text = (
    <div className="tt-sheet__text">
      <h2 className="tt-sheet__title" id={`${id}-title`}>
        {art ? null : (
          <span className="tt-sheet__mark" aria-hidden>
            {look.icon}
            {tone === "ok" ? <HoneyBurst /> : null}
          </span>
        )}
        {title}
      </h2>
      {children ? (
        <div className="tt-sheet__body" id={`${id}-body`}>
          {children}
        </div>
      ) : null}
    </div>
  );
  return (
    <section className={`tt-sheet tt-sheet--${tone}`} aria-labelledby={`${id}-title`}>
      <div className="tt-sheet__inner">
        {art ? (
          <div className="tt-sheet__row">
            <img className="tt-sheet__art" src={art.src} width={78} height={Math.round((art.height / art.width) * 78)} alt="" />
            {text}
          </div>
        ) : (
          text
        )}
        <Button
          ref={button}
          block
          variant={look.button}
          onClick={onAction}
          aria-describedby={children ? `${id}-title ${id}-body` : `${id}-title`}
        >
          {actionLabel}
        </Button>
      </div>
    </section>
  );
}
