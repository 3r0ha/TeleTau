"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Illustration, LinkButton, type IllustrationName } from "@teletau/ui";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";
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

function steps(goal: number, t: T): Step[] {
  return [
    {
      art: "heroLanding",
      title: t("Привет! Я пчела"),
      text: t("Пойдём по тропе через весь Башкортостан."),
    },
    {
      art: "sceneLessonComplete",
      title: t("Урок — сота мёда"),
      text: t("Цель дня — {goal} {word}. Заходи каждый день, чтобы не прервать серию.", { goal, word: plural(goal, [t("сота"), t("соты"), t("сот")]) }),
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
  const t = useT();
  const [i, setI] = useState(0);
  const list = steps(goal, t);
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
              {t("Начать урок")}
            </Button>
            <LinkButton tone="neutral" onClick={onClose}>
              {t("Посмотреть тропу")}
            </LinkButton>
          </>
        ) : (
          <>
            <Button block onClick={() => setI(i + 1)}>
              {t("Дальше")}
            </Button>
            <LinkButton tone="neutral" onClick={onClose}>
              {t("Пропустить")}
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
        <p className="tt-visually-hidden">{t("Шаг {n} из {total}", { n: i + 1, total: list.length })}</p>
        <span className="intro__dots" aria-hidden>
          {list.map((s, k) => (
            <span key={s.art} className={k === i ? "intro__dot intro__dot--on" : "intro__dot"} />
          ))}
        </span>
      </div>
    </Dialog>
  );
}
