"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Button, InlineAlert, openSheetEntry, useToast } from "@teletau/ui";
import { useResource } from "@teletau/session/react";
import { describeProblem, isNetworkError } from "@teletau/session/problem";
import { LoadError, LoadingBlock } from "../screens";
import { NewAchievementScreen } from "./Achievements";
import { LeagueUpScreen, NothingToDo, ResultScreen, StreakScreen, type LessonPlace } from "./AfterLesson";
import { learnApi } from "./api";
import { uuidv7 } from "./ids";
import { LessonLoading, LessonPlayer, LessonSaving } from "./LessonPlayer";
import { JumpResultScreen } from "./Jump";
import { currentExercise, flowReducer, initialFlow, jumpNode, REVIEW_NODE, type NodeRef } from "./machine";
import type { Answer, Course, CourseNode, CourseUnit } from "./model";
import { LearnTopBar, Splash, StudentShell, useStudent } from "./StudentShell";
import { Trail, nextNode } from "./Trail";
import { TrailIntro, useTrailIntro } from "./TrailIntro";

const SPLASH_MIN_MS = 700;

/** «Знакомство · урок 3»: тема юнита и номер урока среди уроков юнита. */
function placeOf(course: Course | undefined, nodeId: string): LessonPlace {
  const unit = course?.units.find((u) => u.nodes.some((n) => n.id === nodeId));
  if (!unit) return {};
  const lessons = unit.nodes.filter((n) => n.kind !== "help_language");
  const i = lessons.findIndex((n) => n.id === nodeId);
  return { topicRu: unit.topicRu, ...(i >= 0 ? { lessonNumber: i + 1 } : {}) };
}
/** Заставка уже была в этой загрузке страницы: переходы между вкладками её не повторяют. */
let splashDone = false;

/** Заставка при открытии приложения — пока грузится тропа, но не короче SPLASH_MIN_MS (иначе мигнёт). */
function useSplash(ready: boolean): boolean {
  const [active] = useState(() => !splashDone);
  const [minDone, setMinDone] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setMinDone(true), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, [active]);
  const visible = active && !(ready && minDone);
  useEffect(() => {
    if (active && !visible) splashDone = true;
  }, [active, visible]);
  return visible;
}

/**
 * Вкладка «Путь»: тропа, урок и поток после урока — одним автоматом состояний (machine.ts). Здесь — только побочные
 * эффекты: запросы к API по состоянию автомата, «Назад» во время урока и обновление тропы после него.
 */
export function LearnFlow() {
  const account = useStudent();
  const toast = useToast();
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  /** Урок не открылся: ошибка остаётся на тропе плашкой с повтором — тост гаснет через 5 с, а плашка нет. */
  const [startError, setStartError] = useState<{ node: NodeRef; runId: string; message: string } | null>(null);
  const course = useResource(() => learnApi.course(), [account?.id], { enabled: Boolean(account) });
  const progress = useResource(() => learnApi.progress(), [account?.id], { enabled: Boolean(account) });
  const splash = useSplash(Boolean(course.data || course.error));

  // Начать урок: runId клиента — повтор запроса вернёт тот же прогон.
  const start = useCallback((node: CourseNode) => {
    if (node.state === "locked") return;
    dispatch({ type: "start", node: { id: node.id, kind: node.kind }, runId: uuidv7() });
  }, []);
  // Испытание для перехода к закрытому месту (docs/02 §2): знающий открывает место, не проходя уроки перед ним.
  const startJump = useCallback((unit: CourseUnit) => {
    if (!unit.jump) return;
    dispatch({ type: "start", node: jumpNode(unit.id), runId: uuidv7() });
  }, []);
  // Повторение слов, срок которых наступил: короткий урок из них (POST /reviews/runs).
  const startReview = useCallback(() => dispatch({ type: "start", node: REVIEW_NODE, runId: uuidv7() }), []);

  // «Повторить» из словаря ведёт на тропу с ?review=1: повторение начинается сразу, адрес очищается.
  const reviewLink = useRef(false);
  useEffect(() => {
    if (reviewLink.current || !course.data || splash) return;
    reviewLink.current = true;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("review")) return;
    url.searchParams.delete("review");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    if ((course.data.review?.due ?? 0) > 0) startReview();
  }, [course.data, splash, startReview]);

  useEffect(() => {
    if (state.screen !== "starting") return;
    let cancelled = false;
    // Новая попытка открытия урока — прежняя ошибка больше не нужна (повтор идёт с тем же runId).
    setStartError(null);
    const run =
      state.node.kind === "review"
        ? learnApi.startReview(state.runId)
        : state.node.kind === "jump"
          ? learnApi.startJump(state.node.id, state.runId)
          : learnApi.startRun(state.node.id, state.runId);
    run.then(
      (run) => !cancelled && dispatch({ type: "runReady", run, now: Date.now() }),
      (e: unknown) => {
        if (cancelled) return;
        dispatch({ type: "runFailed" });
        // Тост живёт 5 секунд и гаснет: ошибка остаётся на тропе плашкой с повтором (не «тихо ничего не произошло»).
        setStartError({
          node: state.node,
          runId: state.runId,
          message: isNetworkError(e) ? "Нет связи. Урок не открылся." : describeProblem(e, "child"),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [state]);

  // Время ответа — от показа упражнения.
  const shownAt = useRef(Date.now());
  const lesson = state.screen === "lesson" ? state.lesson : null;
  const stepKey = lesson ? `${lesson.queue[0]}:${lesson.shownBefore[lesson.queue[0] ?? ""] ?? 0}` : "";
  useEffect(() => {
    shownAt.current = Date.now();
  }, [stepKey]);

  const check = useCallback(
    (answer: Answer, hintsUsed: number) => {
      if (!lesson) return;
      const exercise = currentExercise(lesson);
      // У карточки «Новое слово» ответа нет — на сервер ничего не уходит.
      if (!exercise || exercise.type === "word_intro" || lesson.checking || lesson.feedback) return;
      const attemptId = lesson.attemptId ?? uuidv7();
      dispatch({ type: "check", attemptId });
      // Открытые подсказки — в ответ: мёд тот же, но слово вернётся в повторение раньше (Hard).
      const hints = hintsUsed > 0 ? { hintsUsed } : {};
      learnApi.attempt(lesson.run.runId, { attemptId, exerciseId: exercise.id, answer, latencyMs: Date.now() - shownAt.current, ...hints }).then(
        (result) => dispatch({ type: "verdict", result }),
        (e: unknown) => {
          dispatch({ type: "attemptFailed" });
          toast(isNetworkError(e) ? "Нет связи. Нажми «Проверить» ещё раз." : describeProblem(e, "child"), "error");
        },
      );
    },
    [lesson, toast],
  );

  // Итог урока: тот же runId при повторе — мёд не начислится дважды. Экран серии — только если этот урок выполнил
  // цель дня (до урока она ещё не была выполнена).
  const goalDoneBefore = progress.data?.streak.extendedToday ?? false;
  useEffect(() => {
    if (state.screen !== "completing" || state.failed) return;
    let cancelled = false;
    learnApi.complete(state.lesson.run.runId).then(
      (summary) => !cancelled && dispatch({ type: "completed", summary, showStreak: summary.streak.extendedToday && !goalDoneBefore }),
      () => !cancelled && dispatch({ type: "completeFailed" }),
    );
    return () => {
      cancelled = true;
    };
  }, [state, goalDoneBefore]);

  // Итог прошлой недели лиги без повышения — отмечаем просмотренным молча (празднуем только повышение).
  const summary = state.screen === "result" ? state.summary : null;
  useEffect(() => {
    const result = summary?.leagueResult;
    if (result && result.outcome !== "promoted") void learnApi.leagueResultSeen(result.weekStart).catch(() => undefined);
  }, [summary]);

  // «Назад» во время урока не уводит со страницы, а спрашивает «Уже уходишь?» (как крестик).
  const inLesson = state.screen === "lesson";
  useEffect(() => {
    if (!inLesson) return;
    let release: (() => void) | null = null;
    const arm = () => {
      release = openSheetEntry(() => {
        release = null;
        dispatch({ type: "quit" });
        arm();
      });
    };
    arm();
    return () => release?.();
  }, [inLesson]);

  // Вернулись на тропу после урока — свежие узлы и счётчики.
  const onTrail = state.screen === "trail";
  const wasAway = useRef(false);
  useEffect(() => {
    if (!onTrail) {
      wasAway.current = true;
      return;
    }
    if (wasAway.current) {
      wasAway.current = false;
      // Куда прокрутить, решает сама тропа (Trail): после урока — к запечатанному узлу, иначе — к текущему месту.
      course.reload();
      progress.reload();
    }
    // course и progress — новые объекты на каждой отрисовке; reload у них стабилен
  }, [onTrail]);

  const [leagueBusy, setLeagueBusy] = useState(false);
  // Первый заход на тропу: знакомство с пчелой (ни одного пройденного урока).
  const [introOpen, closeIntro] = useTrailIntro(account?.id, state.screen === "trail" && !splash && progress.data?.lessonsCompleted === 0 && Boolean(course.data && nextNode(course.data)));

  if (splash) return <Splash />;

  switch (state.screen) {
    case "starting":
      return <LessonLoading onLeave={() => dispatch({ type: "runFailed" })} />;
    case "lesson":
      return (
        <LessonPlayer
          lesson={state.lesson}
          onCheck={check}
          onNext={() => dispatch({ type: "next" })}
          onQuit={() => dispatch({ type: "quit" })}
          onStay={() => dispatch({ type: "stay" })}
          onLeave={() => dispatch({ type: "leave" })}
        />
      );
    case "empty":
      return <NothingToDo kind={state.node.kind} onContinue={() => dispatch({ type: "continue" })} />;
    case "completing":
      return <LessonSaving failed={state.failed} onRetry={() => dispatch({ type: "retryComplete" })} onLeave={() => dispatch({ type: "leave" })} />;
    case "result":
      if (state.summary.jump) return <JumpResultScreen course={course.data} summary={state.summary} onContinue={() => dispatch({ type: "continue" })} />;
      return <ResultScreen run={state.run} summary={state.summary} place={placeOf(course.data, state.node.id)} onContinue={() => dispatch({ type: "continue" })} />;
    case "streak":
      return <StreakScreen summary={state.summary} onContinue={() => dispatch({ type: "continue" })} />;
    case "achievement":
      return <NewAchievementScreen summary={state.summary} onContinue={() => dispatch({ type: "continue" })} />;
    case "leagueUp":
      return (
        <LeagueUpScreen
          summary={state.summary}
          busy={leagueBusy}
          onContinue={async () => {
            setLeagueBusy(true);
            const week = state.summary.leagueResult?.weekStart;
            if (week) await learnApi.leagueResultSeen(week).catch(() => undefined);
            setLeagueBusy(false);
            dispatch({ type: "continue" });
          }}
        />
      );
    case "trail":
      return (
        <StudentShell
          tab="path"
          top={<LearnTopBar progress={progress.data} />}
          rail={{ course: course.data, progress: progress.data, onStart: start, onReview: startReview }}
        >
          {course.data ? (
            <>
              {startError ? (
                <div className="tt-stack tt-stack--tight">
                  <InlineAlert tone="danger">{startError.message}</InlineAlert>
                  {/* Повтор — с тем же runId: если сервер его уже создал, дубликата не будет. */}
                  <Button onClick={() => dispatch({ type: "start", node: startError.node, runId: startError.runId })}>
                    Попробовать ещё раз
                  </Button>
                </div>
              ) : null}
              <Trail course={course.data} onStart={start} sealed={state.sealed} reviewDue={course.data.review?.due ?? 0} onReview={startReview} onJump={startJump} />
              <TrailIntro
                open={introOpen}
                goal={progress.data?.dailyGoal?.target ?? 2}
                onClose={closeIntro}
                onStart={() => {
                  const first = course.data && nextNode(course.data);
                  if (first) start(first);
                }}
              />
            </>
          ) : course.error ? (
            <LoadError error={course.error} onRetry={course.reload} audience="child" />
          ) : (
            <LoadingBlock rows={4} label="Открываем тропу" />
          )}
        </StudentShell>
      );
  }
}
