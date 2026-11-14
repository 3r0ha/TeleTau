"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUp, ArrowsClockwise, CaretRight, ChalkboardTeacher, CheckCircle, Drop, Fire } from "@phosphor-icons/react/ssr";
import { Button, ButtonLink, Card, Illustration, InlineAlert, LEAGUE_TIERS, ProgressBar, SHELL_RAIL_QUERY, Skeleton, hexPath, leagueBadges, useMediaQuery, type StudentSection } from "@teletau/ui";
import { serverNow } from "@teletau/session/clock";
import { describeProblem } from "@teletau/session/problem";
import { useResource, useSession } from "@teletau/session/react";
import { assignmentTitle, dueForStudent, ufaDay } from "../assignments";
import { ClassTitle } from "../screens";
import { useT } from "../../../i18n/client";
import { learnApi } from "./api";
import { plural, questTask, TIER_NAMES, weekdayShort } from "./format";
import type { ClassHive, Course, CourseNode, LeagueStanding, MyProgress, StreakDay } from "./model";
import { useStudentPaths } from "./paths";

/** Что вкладка уже загрузила (правая колонка не грузит это второй раз) и действия тропы. */
export interface RailData {
  course?: Course;
  progress?: MyProgress;
  league?: LeagueStanding;
  hive?: ClassHive;
  /** Тропа: «Начать задание» начинает урок прямо здесь, без перехода. */
  onStart?: (node: CourseNode) => void;
  /** Тропа: «Повторить» начинает повторение прямо здесь. */
  onReview?: () => void;
}

/**
 * Правая колонка на компьютере (≥ 1024 px, docs/05 §8 п. 1 «справа — улей класса»): счётчики, цель дня с неделей
 * серии, задание учителя и «Повторить N слов», лига (место и сколько до повышения), квест улья класса. На тропе задания
 * и повторение живут здесь, а не над тропой (learn/shell.css), — тропа видна с первого экрана. Карточка того, что
 * уже открыто в центре, не повторяется: на «Лиге» нет карточки лиги, на «Классе» — квеста, в «Словаре» — повторения.
 * На телефоне и планшете колонки нет — и её данные не загружаются.
 */
export function StudentRail({ tab, course: givenCourse, progress: givenProgress, league: givenLeague, hive: givenHive, onStart, onReview }: RailData & { tab: StudentSection }) {
  const wide = useMediaQuery(SHELL_RAIL_QUERY);
  const state = useSession();
  const me = state.status === "authenticated" && state.account.nickname ? state.account : null;
  const on = wide && Boolean(me);
  const klass = me?.classes.find((c) => c.role === "student") ?? me?.classes[0];

  const progressRes = useResource(() => learnApi.progress(), [me?.id], { enabled: on && !givenProgress });
  const courseRes = useResource(() => learnApi.course(), [me?.id], { enabled: on && !givenCourse });
  const progress = givenProgress ?? progressRes.data;
  const course = givenCourse ?? courseRes.data;
  // Лига и улей обновляются вместе с мёдом и пройденными уроками (после урока тропа перезагружает прогресс).
  const honey = progress?.honey.total;
  const lessons = progress?.lessonsCompleted;
  const showLeague = tab !== "league";
  const showQuest = tab !== "hive" && Boolean(klass);
  const leagueRes = useResource(() => learnApi.league(), [me?.id, honey], { enabled: on && showLeague && !givenLeague && honey !== undefined });
  const hiveRes = useResource(() => learnApi.hive(klass!.id), [klass?.id, lessons], { enabled: on && showQuest && !givenHive && lessons !== undefined });
  const league = givenLeague ?? leagueRes.data;
  const hive = givenHive ?? hiveRes.data;

  const ref = useRef<HTMLElement>(null);
  useStickyRail(ref, on);
  const t = useT();

  if (!on) return null;
  return (
    <aside ref={ref} className="tt-shell__rail rail" aria-label={t("Мой день")}>
      {progress ? (
        <>
          <RailStats progress={progress} />
          <GoalCard progress={progress} />
        </>
      ) : progressRes.error ? (
        // Колонка не может тихо исчезнуть: показываем, что не загрузилось, и даём обновить.
        <RailError error={progressRes.error} onRetry={progressRes.reload} />
      ) : (
        <div className="rail__skeleton" aria-hidden>
          <Skeleton height={44} />
          <Skeleton height={196} radius="card" />
        </div>
      )}
      {course ? <RailTasks course={course} tab={tab} onStart={onStart} onReview={onReview} /> : null}
      {showLeague ? (league ? <LeagueCard league={league} /> : leagueRes.error ? <RailError error={leagueRes.error} onRetry={leagueRes.reload} /> : null) : null}
      {showQuest && klass ? (hive ? <QuestCard hive={hive} classTitle={klass.title} /> : hiveRes.error ? <RailError error={hiveRes.error} onRetry={hiveRes.reload} /> : null) : null}
    </aside>
  );
}

/** Карточка колонки не загрузилась: тихо исчезать нельзя — объясняем и даём обновить. */
function RailError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="tt-stack tt-stack--tight">
      <InlineAlert tone="danger">{describeProblem(error, "child")}</InlineAlert>
      <Button small variant="secondary" onClick={onRetry}>
        {t("Обновить")}
      </Button>
    </div>
  );
}

/**
 * Колонка липкая (shell.css): помещается в окно — прилипает верхом, выше окна — сначала прокручивается до своего низа
 * и прилипает им (иначе низ колонки не увидеть). Отступ — свойством CSSOM `--shell-rail-top`: строгая CSP запрещает
 * атрибут style в разметке, но не CSSOM.
 */
function useStickyRail(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const update = () => el.style.setProperty("--shell-rail-top", `${Math.min(0, window.innerHeight - el.offsetHeight)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref, on]);
}

/** Счётчики, как в шапке тропы на телефоне: серия, мёд, значок лиги. */
function RailStats({ progress }: { progress: MyProgress }) {
  const t = useT();
  const streak = progress.streak.current;
  const honey = progress.honey.total;
  const tier = progress.league?.tier;
  return (
    <ul className="rail-stats" aria-label={t("Счётчики")}>
      <li className={["rail-stat", "rail-stat--streak", streak > 0 && "rail-stat--lit"].filter(Boolean).join(" ")}>
        <Fire weight="fill" aria-hidden />
        <b>{streak}</b>
        <span className="tt-visually-hidden">{plural(streak, [t("день подряд"), t("дня подряд"), t("дней подряд")])}</span>
      </li>
      <li className="rail-stat rail-stat--honey">
        <Drop weight="fill" aria-hidden />
        <b>{honey}</b>
        <span className="tt-visually-hidden">{t("мёда")}</span>
      </li>
      {tier ? (
        <li className="rail-stat rail-stat--league">
          <Illustration name={leagueBadges[tier]} width={36} alt={t("Лига {name}", { name: TIER_NAMES[tier].gen })} />
        </li>
      ) : null}
    </ul>
  );
}

const CELL_W = 52;
const CELL_H = 46;
const CELL_LIP = 4;

/** Цель дня — соты-уроки (сделанные — мёд с галочкой), под ними неделя серии. */
function GoalCard({ progress }: { progress: MyProgress }) {
  const t = useT();
  const goal = progress.dailyGoal;
  const { streak } = progress;
  const done = goal ? Math.min(goal.done, goal.target) : 0;
  // Подписи дней недели серии — фабрика от t (константой быть не может: зависит от языка).
  const dayText: Record<StreakDay["status"], string> = {
    done: t("цель выполнена"),
    frozen: t("заморозка"),
    missed: t("пропуск"),
    today: t("сегодня"),
    future: t("впереди"),
  };
  return (
    <Card as="section" className="rail-card rail-goal" aria-labelledby="rail-goal-title">
      <div className="rail-card__head">
        <h2 className="rail-card__title" id="rail-goal-title">
          {t("Цель дня")}
        </h2>
        {goal ? (
          <span className="rail-card__meta">
            {t("{n} из {total}", { n: done, total: goal.target })}
          </span>
        ) : null}
      </div>
      {goal ? (
        <>
          <div className="rail-goal__cells" aria-hidden>
            {Array.from({ length: goal.target }, (_, i) => (
              <svg key={i} className={i < done ? "rail-cell rail-cell--done" : "rail-cell"} width={CELL_W} height={CELL_H + CELL_LIP} viewBox={`0 0 ${CELL_W} ${CELL_H + CELL_LIP}`} focusable="false">
                <path className="rail-cell__lip" d={hexPath(CELL_W, CELL_H, 6, 0, CELL_LIP)} />
                <path className="rail-cell__face" d={hexPath(CELL_W, CELL_H, 6)} />
                {i < done ? <path className="rail-cell__check" d="M17 23.5l6.5 6.5 12-13" /> : null}
              </svg>
            ))}
          </div>
          {goal.met ? <p className="rail-card__sub">{t("Цель выполнена")}</p> : null}
        </>
      ) : null}
      <div className="rail-streak">
        <p className={["rail-streak__count", streak.current > 0 && "rail-streak__count--lit"].filter(Boolean).join(" ")}>
          <Fire weight="fill" aria-hidden />
          {streak.current} {plural(streak.current, [t("день подряд"), t("дня подряд"), t("дней подряд")])}
        </p>
        <ol className="rail-week" aria-label={t("Неделя")}>
          {streak.week.map((d) => (
            <li key={d.date} className={`rail-week__day rail-week__day--${d.status}`}>
              <svg width={28} height={25} viewBox="0 0 28 25" aria-hidden focusable="false">
                <path className="rail-week__hex" d={hexPath(26, 23, 3, 1, 1)} />
              </svg>
              <span aria-hidden>{weekdayShort(d.date)}</span>
              <span className="tt-visually-hidden">
                {weekdayShort(d.date)}: {dayText[d.status]}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/**
 * Задания учителя (ADR 0021) и «Повторить N слов» — как плашки на тропе телефона. На тропе кнопки начинают урок здесь
 * же, на других вкладках ведут на тропу.
 */
function RailTasks({ course, tab, onStart, onReview }: { course: Course; tab: StudentSection; onStart?: (node: CourseNode) => void; onReview?: () => void }) {
  const paths = useStudentPaths();
  const t = useT();
  const list = [...(course.assignments ?? [])].sort((a, b) => Number(a.done) - Number(b.done));
  const due = tab === "words" ? 0 : (course.review?.due ?? 0);
  if (!list.length && !due) return null;
  const today = ufaDay(serverNow());
  const nodes = course.units.flatMap((u) => u.nodes);
  return (
    <>
      {list.map((a) => {
        const titleId = `rail-task-${a.id}`;
        if (a.done) {
          return (
            <section key={a.id} className="task-card task-card--done rail-task" aria-labelledby={titleId}>
              <CheckCircle weight="fill" className="task-card__check" aria-hidden />
              <div>
                <p className="task-card__kicker">{t("Задание учителя выполнено")}</p>
                <h2 className="task-card__title task-card__title--small" id={titleId}>
                  {assignmentTitle(a)}
                </h2>
              </div>
            </section>
          );
        }
        const node = a.lessonId ? nodes.find((n) => n.id === a.lessonId) : undefined;
        const start = a.kind === "review" ? onReview : node && node.state !== "locked" && onStart ? () => onStart(node) : undefined;
        return (
          <section key={a.id} className="task-card rail-task" aria-labelledby={titleId}>
            <div className="task-card__row">
              <Illustration name="beeTeacher" width={56} className="task-card__bee" />
              <div>
                <p className="task-card__kicker">
                  <ChalkboardTeacher weight="fill" aria-hidden />
                  {t("Задание учителя")} · <span className="task-card__due">{dueForStudent(a.dueOn, today)}</span>
                </p>
                <h2 className="task-card__title" id={titleId}>
                  {assignmentTitle(a)}
                </h2>
              </div>
            </div>
            {tab === "path" ? (
              start ? (
                <Button block onClick={start}>
                  {t("Начать задание")}
                </Button>
              ) : null
            ) : (
              <ButtonLink block href={a.kind === "review" ? paths.review : paths.learn}>
                {t("К заданию")}
              </ButtonLink>
            )}
          </section>
        );
      })}
      {due > 0 ? (
        <section className="review-card rail-review" aria-labelledby="rail-review-title">
          <div className="review-card__row">
            <Illustration name="beeRead" width={52} className="review-card__bee" />
            <div>
              <h2 className="review-card__title" id="rail-review-title">
                {t("Повторить {n} {word}", { n: due, word: plural(due, [t("слово"), t("слова"), t("слов")]) })}
              </h2>
            </div>
          </div>
          {tab === "path" && onReview ? (
            <Button block icon={<ArrowsClockwise weight="bold" aria-hidden />} onClick={onReview}>
              {t("Начать")}
            </Button>
          ) : (
            <ButtonLink block href={paths.review} icon={<ArrowsClockwise weight="bold" aria-hidden />}>
              {t("Начать")}
            </ButtonLink>
          )}
        </section>
      ) : null}
    </>
  );
}

/** Лига недели: значок, место, мёд и что нужно для повышения. */
function LeagueCard({ league }: { league: LeagueStanding }) {
  const paths = useStudentPaths();
  const t = useT();
  const name = TIER_NAMES[league.tier];
  const next = LEAGUE_TIERS[LEAGUE_TIERS.indexOf(league.tier) + 1];
  const mine = league.members.find((m) => m.me) ?? league.me;
  const lastUp = league.members.filter((m) => m.zone === "promote").at(-1);
  let status: { up?: boolean; text: string };
  if (!mine) status = { text: t("Пройди урок, чтобы попасть в таблицу.") };
  else if (!next || league.zones.promote === 0) status = { text: t("Это высшая лига.") };
  else if (mine.zone === "promote") status = { up: true, text: t("Ты в зоне повышения") };
  else if (lastUp) {
    const need = Math.max(1, lastUp.points - mine.points + 1);
    status = { text: t("До повышения — {n} мёда", { n: need }) };
  } else status = { text: t("Первые {n} перейдут в Лигу {name}.", { n: league.zones.promote, name: TIER_NAMES[next].gen }) };
  return (
    <Card as="section" className="rail-card rail-league" aria-labelledby="rail-league-title">
      <div className="rail-league__row">
        <Illustration name={leagueBadges[league.tier]} width={60} className="rail-league__badge" />
        <div>
          <h2 className="rail-card__title" id="rail-league-title">
            {t("Лига {name}", { name: name.gen })}
          </h2>
          {mine ? (
            <p className="rail-card__sub">
              {t("{rank}-е место · {points} мёда", { rank: mine.rank, points: mine.points })}
            </p>
          ) : null}
        </div>
      </div>
      <p className={["rail-league__status", status.up && "rail-league__status--up"].filter(Boolean).join(" ")}>
        {status.up ? <ArrowUp weight="bold" aria-hidden /> : null}
        {status.text}
      </p>
      <Link href={paths.league} className="rail-card__link">
        {t("Открыть таблицу")}
        <CaretRight weight="bold" aria-hidden />
      </Link>
    </Card>
  );
}

/** Квест недели улья класса — общий прогресс, без рейтингов отдельных детей (docs/05 §8, п. 5). */
function QuestCard({ hive, classTitle }: { hive: ClassHive; classTitle: string }) {
  const paths = useStudentPaths();
  const t = useT();
  const { goal, progress, completed } = hive.quest;
  const value = Math.min(progress, goal);
  return (
    <Card as="section" className="rail-card rail-quest" aria-labelledby="rail-quest-title">
      <div className="rail-quest__row">
        <div>
          <p className="rail-card__kicker">
            {t("Улей")} <ClassTitle title={classTitle} />
          </p>
          <h2 className="rail-card__title" id="rail-quest-title">
            {completed ? t("Квест выполнен!") : t("Квест недели")}
          </h2>
        </div>
        <Illustration name="sceneClassHive" width={64} className="rail-quest__art" />
      </div>
      <p className="rail-card__sub">{questTask(goal)}</p>
      <ProgressBar value={value} max={goal} label={t("Квест класса")} valueText={t("{n} из {total}", { n: progress, total: goal })} showValue />
      <Link href={paths.hive} className="rail-card__link">
        {t("Открыть улей")}
        <CaretRight weight="bold" aria-hidden />
      </Link>
    </Card>
  );
}
