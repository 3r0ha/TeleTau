"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Drop } from "@phosphor-icons/react/ssr";
import { Button, GlintBadge, GoalMeter, HoneyConfetti, Illustration, StatTile, StatTiles, hexPath, illustrations, leagueBadges, useCountUp, type IllustrationName } from "@teletau/ui";
import { duration, plural, TIER_NAMES, weekdayShort } from "./format";
import type { LessonRun, LessonSummary, RunKind, StreakDay } from "./model";
import { playSound, type SoundName } from "./sound";

/** Звук экрана — один раз при появлении. */
export function useScreenSound(name: SoundName) {
  useEffect(() => playSound(name), [name]);
}

/** Где урок на тропе — для подписи «Знакомство · урок 4» (из GET /course). */
export interface LessonPlace {
  topicRu?: string;
  /** Номер урока среди уроков юнита (с 1). */
  lessonNumber?: number;
}

/** Полноэкранный шаг после урока (prototype .full): иллюстрация (или свой рисунок visual), заголовок, текст, одна кнопка внизу. */
export function AfterScreen({
  art,
  artAlt,
  visual,
  artMotion,
  wide,
  tone,
  confetti,
  children,
  action,
  actionVariant,
  onAction,
  busy,
}: {
  art?: IllustrationName;
  artAlt?: string;
  /** Рисунок вместо иллюстрации (сота награды). */
  visual?: ReactNode;
  /** Движение картинки (learn.css): hop — прыжок со сжатием, fly — парение. */
  artMotion?: "hop" | "fly";
  wide?: boolean;
  tone?: "violet";
  /** Конфетти из сот — праздник (итог урока, новая лига). */
  confetti?: boolean;
  children: ReactNode;
  action: string;
  actionVariant?: "primary" | "violet";
  onAction: () => void;
  busy?: boolean;
}) {
  const heading = useRef<HTMLDivElement>(null);
  // Новый экран — фокус на его содержимом (читалка объявит заголовок), прокрутка — вверх.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, []);
  return (
    <div className={["after", tone && `after--${tone}`].filter(Boolean).join(" ")}>
      <main id="main" className="after__main">
        <div ref={heading} className="tt-column after__body">
          {art ? (
            <Illustration name={art} alt={artAlt ?? ""} width={wide ? 260 : 236} className={["after__art", artMotion && `after__art--${artMotion}`].filter(Boolean).join(" ")} />
          ) : visual ? (
            <div className="after__art after__visual">{visual}</div>
          ) : null}
          {children}
        </div>
      </main>
      {confetti ? <HoneyConfetti /> : null}
      <footer className="tt-column after__foot">
        <Button block variant={actionVariant ?? "primary"} onClick={onAction} loading={busy}>
          {action}
        </Button>
      </footer>
    </div>
  );
}

/**
 * Упражнений нет (prototype 20-empty-done): у «Помоги языку» закончились дуэли, за которые ученик ещё не голосовал
 * (POST /lessons/{lessonId}/runs отдаёт забег без упражнений), или повторять пока нечего (POST /reviews/runs).
 */
const NOTHING: Record<"help" | "review" | "lesson", { title: string; lead: string }> = {
  help: { title: "Все пары уже оценены", lead: "Новые появятся позже." },
  review: { title: "Пока нечего повторять", lead: "Новые слова появятся после уроков." },
  lesson: { title: "Здесь пока пусто", lead: "В этом уроке пока нет заданий." },
};

export function NothingToDo({ kind, onContinue }: { kind: RunKind; onContinue: () => void }) {
  const text = NOTHING[kind === "help_language" ? "help" : kind === "review" ? "review" : "lesson"];
  return (
    <AfterScreen art="emptyAllDone" artAlt="" action="На тропу" onAction={onContinue}>
      <h1 className="after__title" tabIndex={-1}>
        {text.title}
      </h1>
      <p className="after__lead">{text.lead}</p>
    </AfterScreen>
  );
}

/**
 * Цель дня на итоге урока: выполнена этим уроком — сота «запечатывается» (маленькое празднование); ещё нет —
 * сколько сот осталось. Выполнена раньше — ничего не показываем.
 */
function GoalNote({ summary }: { summary: LessonSummary }) {
  const goal = summary.dailyGoal;
  if (!goal) return null;
  if (summary.dailyGoalReached)
    return (
      <div className="goal-note goal-note--done" role="status">
        <GoalMeter done={goal.done} target={goal.target} celebrate />
        <p>
          <b>Цель дня выполнена</b>
        </p>
      </div>
    );
  if (goal.met) return null;
  const left = goal.target - goal.done;
  return (
    <div className="goal-note">
      <GoalMeter done={goal.done} target={goal.target} />
      <p>
        Ещё {left} {plural(left, ["сота", "соты", "сот"])} до цели дня
      </p>
    </div>
  );
}

/**
 * «Урок пройден!» (prototype 13-result): мёд, точность, время, новые слова. Праздник: пчела на сотах прыгает, сверху
 * падают соты-конфетти, счётчик мёда «набегает» (при «Уменьшении движения» — сразу итог, без конфетти).
 */
export function ResultScreen({ run, summary, place, onContinue }: { run: LessonRun; summary: LessonSummary; place: LessonPlace; onContinue: () => void }) {
  const helping = run.kind === "help_language";
  const reviewing = run.kind === "review";
  const title = helping ? "Спасибо за помощь!" : reviewing ? "Повторение пройдено!" : run.kind === "place_test" ? "Испытание пройдено!" : "Урок пройден!";
  const pending = summary.honey.pendingFromVotes;
  const where = reviewing
    ? ""
    : [place.topicRu, helping ? "Помоги языку" : place.lessonNumber ? `урок ${place.lessonNumber}` : run.titleRu].filter(Boolean).join(" · ");
  const honey = useCountUp(summary.honey.total);
  useScreenSound("complete");
  return (
    <AfterScreen art="sceneLessonComplete" artAlt="Пчела радуется на запечатанных сотах" artMotion="hop" confetti action="Дальше" onAction={onContinue}>
      <h1 className="after__title" tabIndex={-1}>
        {title}
      </h1>
      {where ? (
        <p className="after__lead">
          {where}
          {helping && pending ? ` · ещё +${pending} мёда созреет позже` : null}
        </p>
      ) : null}
      <StatTiles label="Итог урока">
        <StatTile label="Мёд" icon={<Drop weight="fill" />} value={`+${honey}`} />
        <StatTile label="Точность" value={`${Math.round(summary.accuracy * 100)}%`} />
        <StatTile label="Время" value={duration(summary.durationSeconds)} className="stat-time" />
      </StatTiles>
      <GoalNote summary={summary} />
      {summary.newWords.length ? (
        <section className="new-words" aria-labelledby="new-words-title">
          <Illustration name="beeRead" width={60} className="new-words__bee" />
          <div>
            <h2 className="new-words__label" id="new-words-title">
              Новые слова
            </h2>
            <ul className="new-words__list">
              {summary.newWords.map((w) => (
                <li key={w.text} className="new-words__word" lang="ba">
                  {w.text}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </AfterScreen>
  );
}

/**
 * Серия (prototype 14-streak): дни подряд, неделя сотами, заморозки — одной строкой в карточке недели (значок заморозки —
 * сота во льду). Цифра «выпрыгивает», сегодняшняя сота сразу запечатывается мёдом, прошлые дни уже закрыты (learn.css).
 */
export function StreakScreen({ summary, onContinue }: { summary: LessonSummary; onContinue: () => void }) {
  const { current, freezes, week, today } = summary.streak;
  useScreenSound("streak");
  // Цель дня уже на итоге урока — здесь только о серии.
  const lead = current <= 1 ? "Серия началась. Приходи завтра." : "Приходи завтра, чтобы не прервать серию.";
  return (
    <AfterScreen art="sceneStreak" artAlt="Цепочка сот с огоньками" wide action="Дальше" onAction={onContinue}>
      <p className="streak__num" aria-hidden>
        {current}
      </p>
      <h1 className="after__title after__title--tight" tabIndex={-1}>
        <span className="tt-visually-hidden">{current} </span>
        {plural(current, ["день подряд", "дня подряд", "дней подряд"])}
      </h1>
      <p className="after__lead">{lead}</p>
      <div className="week-card">
        <ol className="week" aria-label="Эта неделя">
          {week.map((d) => (
            <WeekDay key={d.date} day={d} today={d.date === today} />
          ))}
        </ol>
        {freezes > 0 ? (
          <p className="week-card__foot">
            <img src={illustrations.itemStreakFreeze.src} width={26} height={Math.round((illustrations.itemStreakFreeze.height / illustrations.itemStreakFreeze.width) * 26)} alt="" />
            {freezes} {plural(freezes, ["заморозка", "заморозки", "заморозок"])} в запасе
          </p>
        ) : null}
      </div>
    </AfterScreen>
  );
}

const DAY_W = 32;
const DAY_H = 28;

const DAY_TEXT: Record<StreakDay["status"], string> = { done: "цель выполнена", frozen: "заморозка", missed: "пропуск", today: "сегодня", future: "впереди" };

function WeekDay({ day, today }: { day: StreakDay; today: boolean }) {
  const state = day.status === "frozen" ? "frozen" : day.status === "done" ? "done" : "empty";
  const text = DAY_TEXT[day.status];
  const lip = state === "empty" ? 0 : 3;
  return (
    <li className={["week__day", today && "week__day--today"].filter(Boolean).join(" ")}>
      <span aria-hidden>{weekdayShort(day.date)}</span>
      <svg width={DAY_W} height={DAY_H + lip} viewBox={`0 0 ${DAY_W} ${DAY_H + lip}`} aria-hidden focusable="false" className={`week__hex week__hex--${state}`}>
        {lip ? <path className="week__lip" d={hexPath(DAY_W, DAY_H, 3.5, 0, lip)} /> : null}
        <path className="week__face" d={state === "empty" ? hexPath(DAY_W - 2, DAY_H - 2, 3.5, 1, 1) : hexPath(DAY_W, DAY_H, 3.5)} />
      </svg>
      <span className="tt-visually-hidden">
        {weekdayShort(day.date)}: {text}
      </span>
    </li>
  );
}

/** «Новая лига — Кипрей!» (prototype 15-league-up): Аҡбуҙат парит и несёт выше, значок новой лиги поднимается с бликом. */
export function LeagueUpScreen({ summary, onContinue, busy }: { summary: LessonSummary; onContinue: () => void; busy?: boolean }) {
  const result = summary.leagueResult;
  useScreenSound("levelUp");
  if (!result) return null;
  const from = TIER_NAMES[result.tierBefore];
  const to = TIER_NAMES[result.tierAfter];
  return (
    <AfterScreen
      art="sceneLeagueUp"
      artAlt="Крылатый жеребёнок Аҡбуҙат"
      artMotion="fly"
      confetti
      tone="violet"
      action="Дальше"
      actionVariant="violet"
      onAction={onContinue}
      busy={busy}
    >
      <h1 className="after__title" tabIndex={-1}>
        Новая лига — {to.nom}!
      </h1>
      <p className="after__lead">Ты среди лучших в Лиге {from.gen}.</p>
      <GlintBadge name={leagueBadges[result.tierAfter]} alt={`Значок Лиги ${to.gen}`} width={96} rise className="after__badge" />
    </AfterScreen>
  );
}
