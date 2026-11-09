"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Illustration, LinkButton, type IllustrationName } from "@teletau/ui";
import { plural } from "./format";

/**
 * Знакомство с пчелой при первом заходе на тропу (ученик ещё не прошёл ни одного урока): два коротких шага — тропа,
 * затем урок-сота, цель дня и серия. Первый можно пропустить; последний сразу начинает первый урок. Увиденное помнит
 * это устройство (только номер аккаунта, без ПДн).
 */
const seenKey = (accountId: string) => `teletau.intro-seen.${accountId}`;

function wasSeen(accountId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(accountId)) === "1";
  } catch {
    return false;
  }
}

function markSeen(accountId: string) {
  try {
    window.localStorage.setItem(seenKey(accountId), "1");
  } catch {
    // Хранилище недоступно — знакомство покажется ещё раз, ничего страшного.
  }
}

interface Step {
  art: IllustrationName;
  title: string;
  text: string;
}

function steps(goal: number): Step[] {
  return [
    {
      art: "heroLanding",
      title: "Привет! Я пчела",
      text: "Пойдём по тропе через весь Башкортостан.",
    },
    {
      art: "sceneLessonComplete",
      title: "Урок — сота мёда",
      text: `Цель дня — ${goal} ${plural(goal, ["сота", "соты", "сот"])}. Заходи каждый день, чтобы не прервать серию.`,
    },
  ];
}

export function useTrailIntro(
  accountId: string | undefined,
  firstTime: boolean,
): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (accountId && firstTime && !wasSeen(accountId)) setOpen(true);
  }, [accountId, firstTime]);
  const close = () => {
    if (accountId) markSeen(accountId);
    setOpen(false);
  };
  return [open, close];
}

export function TrailIntro({
  open,
  goal,
  onClose,
  onStart,
}: {
  open: boolean;
  goal: number;
  onClose: () => void;
  onStart: () => void;
}) {
  const [i, setI] = useState(0);
  const list = steps(goal);
  const step = list[i]!;
  const last = i === list.length - 1;
  // Лист открывается сам, без нажатия: фокус — на картинке шага (без рамки), а не на кнопке. Иначе браузер считает
  // программный фокус «клавиатурным» и рисует кольцо на «Дальше», хотя ученик ещё ничего не нажимал.
  const start = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      initialFocusRef={start}
      title={step.title}
      description={step.text}
      centered
      hideClose
      actions={
        last ? (
          <>
            <Button
              block
              onClick={() => {
                onClose();
                onStart();
              }}
            >
              Начать урок
            </Button>
            <LinkButton tone="neutral" onClick={onClose}>
              Посмотреть тропу
            </LinkButton>
          </>
        ) : (
          <>
            <Button block onClick={() => setI(i + 1)}>
              Дальше
            </Button>
            <LinkButton tone="neutral" onClick={onClose}>
              Пропустить
            </LinkButton>
          </>
        )
      }
    >
      {/* Картинка шага и точки — над заголовком (порядок — в learn.css). */}
      <div className="intro" key={i} ref={i === 0 ? start : undefined} tabIndex={-1}>
        <Illustration
          name={step.art}
          width={step.art === "heroLanding" ? 320 : 220}
          className={`intro__art intro__art--${step.art}`}
        />
        <p className="tt-visually-hidden">
          Шаг {i + 1} из {list.length}
        </p>
        <span className="intro__dots" aria-hidden>
          {list.map((s, k) => (
            <span key={s.art} className={k === i ? "intro__dot intro__dot--on" : "intro__dot"} />
          ))}
        </span>
      </div>
    </Dialog>
  );
}
