"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Fire, Sparkle, X } from "@phosphor-icons/react/ssr";
import { toComparable } from "@teletau/bashkir-text";
import { useSession } from "@teletau/session/react";
import { Button, Dialog, EmptyState, FeedbackSheet, IconButton, LinkButton, ProgressBar, Skeleton, SkeletonGroup, SpeakButton, illustrations } from "@teletau/ui";
import { useT } from "../../../i18n/client";
import { uiModeFor } from "../UiMode";
import { learnApi } from "./api";
import { localAudio } from "./audio";
import { Duel } from "./Duel";
import { ChoiceTask, FreeTask, PairsTask, TilesTask, WordIntro } from "./exercises";
import { currentExercise, isIntro, isRetry, lessonProgress, willRetry, type LessonState } from "./machine";
import type { Answer, AttemptResult, DuelChoice, Exercise } from "./model";
import { playSound, primeSounds, type SoundName } from "./sound";

const VERDICT_SOUND: Record<AttemptResult["verdict"], SoundName> = { correct: "correct", typo: "correct", almost: "almost", wrong: "wrong", recorded: "voted" };

/** С какого числа верных ответов подряд лист «Верно» показывает огонёк «N подряд». */
const COMBO_FROM = 3;

interface LessonPlayerProps {
  lesson: LessonState;
  /** hintsUsed — сколько разных подсказок к условию открыли до ответа (AttemptRequest.hintsUsed). */
  onCheck: (answer: Answer, hintsUsed: number) => void;
  onNext: () => void;
  onQuit: () => void;
  onStay: () => void;
  onLeave: () => void;
}

/**
 * Плеер урока (prototype 05–12): крестик и прогресс, задание, «Проверить» в зоне большого пальца, после ответа —
 * лист «Верно / Почти / Пока не так / Голос учтён». Enter — проверить и дальше, 1–4 — выбрать вариант. Карточка
 * «Новое слово» — без проверки: вместо «Проверить» сразу «Дальше».
 */
export function LessonPlayer({ lesson, onCheck, onNext, onQuit, onStay, onLeave }: LessonPlayerProps) {
  const t = useT();
  const exercise = currentExercise(lesson);
  const retry = isRetry(lesson);
  const intro = isIntro(lesson);
  // «Пчёлка» (1–4 класс): без «Почему так?» — объяснение длиннее, чем допускает режим (docs/05 §7).
  const bee = uiModeFor(useSession(), usePathname()) === "bee";
  const stepKey = `${exercise?.id}:${lesson.shownBefore[exercise?.id ?? ""] ?? 0}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { feedback, checking } = lesson;
  // Верные ответы подряд в этом уроке (огонёк «3 подряд» на листе): ошибка обнуляет счёт.
  const [combo, setCombo] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);
  // Подсказки к условию, открытые до ответа на текущее упражнение (номера в hints).
  const hintsOpened = useRef(new Set<number>());

  useEffect(() => primeSounds(), []);

  // Вердикт пришёл: звук и счёт «подряд» — по одному разу на ответ (attemptId).
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (!feedback || counted.current === feedback.attemptId) return;
    counted.current = feedback.attemptId;
    playSound(VERDICT_SOUND[feedback.verdict]);
    if (feedback.verdict === "recorded") return;
    setCombo((c) => (feedback.verdict === "wrong" ? 0 : c + 1));
  }, [feedback]);

  // Новое упражнение: черновик ответа сброшен, фокус — на заголовке (читалка начинает с задания). Новое слово —
  // мягкий звук знакомства.
  useEffect(() => {
    setAnswer(null);
    hintsOpened.current = new Set();
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    if (intro) playSound("newWord");
  }, [stepKey, intro]);

  const canCheck = Boolean(answer) && !feedback && !checking;
  const check = () => {
    if (answer && canCheck) onCheck(answer, hintsOpened.current.size);
  };

  // Enter: проверить, а на листе — дальше. На кнопках и ссылках Enter нажимает их сам; на варианте ответа — проверяет.
  const latest = useRef({ check, onNext, feedback, intro, quit: lesson.quit });
  latest.current = { check, onNext, feedback, intro, quit: lesson.quit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || latest.current.quit) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "TEXTAREA") return;
      if (t?.closest("a, button:not([role='radio'])")) return;
      e.preventDefault();
      if (latest.current.feedback || latest.current.intro) latest.current.onNext();
      else latest.current.check();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const total = lesson.run.exercises.length;
  const done = Math.round(lessonProgress(lesson) * total);

  // Полоса выросла — короткая вспышка мёда на ней (learn.css, только без «Уменьшения движения»).
  const shownDone = useRef(done);
  useEffect(() => {
    const el = progressRef.current;
    if (!el || done <= shownDone.current) {
      shownDone.current = done;
      return;
    }
    shownDone.current = done;
    el.classList.remove("lesson__progress--bump");
    void el.offsetWidth;
    el.classList.add("lesson__progress--bump");
  }, [done]);
  const isDuel = exercise?.type === "duel";
  // Подсказку, открытую после проверки, не считаем: ответ уже дан.
  const onHint = (i: number) => {
    if (!feedback && !checking) hintsOpened.current.add(i);
  };
  const common = { onAnswer: setAnswer, onHint, onSubmit: check, disabled: Boolean(feedback) || checking, retry, review: lesson.run.kind === "review", headingRef: heading, result: feedback };

  return (
    <div className="lesson">
      <header className="lesson__head">
        <div className="tt-column lesson__head-inner">
          <IconButton label={t("Выйти из урока")} icon={<X weight="bold" />} onClick={onQuit} />
          <div ref={progressRef} className="lesson__progress">
            <ProgressBar value={done} max={total} label={t("Прогресс урока")} valueText={t("Пройдено {done} из {total}", { done, total })} />
          </div>
        </div>
      </header>
      {/* data-verdict — для движения после ответа (learn.css): «Пока не так» коротко покачивает выбранный ответ. */}
      <main id="main" className="lesson__body" data-verdict={feedback?.verdict}>
        <div className={["tt-column lesson__column", intro && "lesson__column--intro"].filter(Boolean).join(" ")} key={stepKey}>
          {exercise ? (
            <ExerciseBody exercise={exercise} common={common} answer={answer} onVote={(choice) => setAnswer({ type: "duel", choice })} />
          ) : null}
        </div>
      </main>
      <footer className="lesson__foot">
        {feedback && exercise ? (
          <Feedback
            exercise={exercise}
            result={feedback}
            answer={answer}
            runId={lesson.run.runId}
            retryLater={willRetry(lesson)}
            index={lesson.finished.length}
            combo={combo}
            explain={!bee}
            onNext={onNext}
          />
        ) : intro ? (
          <div className="tt-column lesson__check">
            <Button block onClick={onNext}>
              {t("Дальше")}
            </Button>
          </div>
        ) : (
          <div className="tt-column lesson__check">
            <Button block variant={isDuel ? "violet" : "primary"} disabled={!answer} loading={checking} onClick={check}>
              {isDuel ? t("Отдать голос") : t("Проверить")}
            </Button>
          </div>
        )}
      </footer>
      <QuitDialog open={lesson.quit} onStay={onStay} onLeave={onLeave} />
    </div>
  );
}

function ExerciseBody({
  exercise,
  common,
  answer,
  onVote,
}: {
  exercise: Exercise;
  common: {
    onAnswer: (a: Answer | null) => void;
    onHint: (index: number) => void;
    onSubmit: () => void;
    disabled: boolean;
    retry: boolean;
    review: boolean;
    headingRef: React.Ref<HTMLHeadingElement>;
    result: AttemptResult | null;
  };
  answer: Answer | null;
  onVote: (v: DuelChoice) => void;
}) {
  switch (exercise.type) {
    case "tiles_ru_ba":
      return <TilesTask exercise={exercise} {...common} />;
    case "choice_ba_ru":
      return <ChoiceTask exercise={exercise} {...common} />;
    case "free_ru_ba":
      return <FreeTask exercise={exercise} {...common} />;
    case "match_pairs":
      return <PairsTask exercise={exercise} {...common} />;
    case "word_intro":
      return <WordIntro exercise={exercise} headingRef={common.headingRef} />;
    case "duel":
      return (
        <Duel
          sourceRu={exercise.sourceRu}
          a={exercise.a}
          b={exercise.b}
          value={answer?.type === "duel" ? answer.choice : null}
          onChange={onVote}
          disabled={common.disabled}
          keyboard
          headingRef={common.headingRef}
        />
      );
  }
}

/** Башкирская строка ответа — с lang="ba" (озвучка и шрифтовые формы). */
const Ba = ({ children }: { children: ReactNode }) => <b lang="ba">{children}</b>;

/** Верные пары, которые ученик соединил не так: «ғүзә — «Значение 3»». */
function PairsFix({ exercise, result, links }: { exercise: Extract<Exercise, { type: "match_pairs" }>; result: AttemptResult; links: Map<string, string> }) {
  const wrong = (result.correctPairs ?? []).filter((p) => links.get(p.left) !== p.right);
  if (!wrong.length) return null;
  return (
    <ul className="pairs-fix">
      {wrong.map((p) => (
        <li key={p.left}>
          <Ba>{exercise.left.find((w) => w.id === p.left)?.text}</Ba> — «{exercise.right.find((r) => r.id === p.right)?.textRu}»
        </li>
      ))}
    </ul>
  );
}

/** Строка листа с записью носителя: текст и «Послушать» рядом. */
function WithListen({ audio, word, children }: { audio?: Parameters<typeof localAudio>[0]; word: string; children: ReactNode }) {
  const t = useT();
  if (localAudio(audio).length === 0) return <>{children}</>;
  return (
    <div className="feedback-listen">
      {children}
      <SpeakButton sources={localAudio(audio)} size="small" label={t("Послушать: {word}", { word })} />
    </div>
  );
}

/**
 * Верный ответ с подсвеченной буквой, на которой ошибся ученик (LetterHint: слово token, буква index — в кодовых точках,
 * без знаков препинания). Не нашли букву — слово без подсветки.
 */
function HintedAnswer({ text, hint }: { text: string; hint?: AttemptResult["hint"] }) {
  if (!hint) return <Ba>{text}</Ba>;
  const words = text.split(/(\s+)/);
  let wordNo = -1;
  const parts = words.map((w, wi) => {
    if (/^\s+$/.test(w) || w === "") return w;
    wordNo++;
    if (wordNo !== hint.token) return w;
    let letter = -1;
    const chars = [...w];
    const at = chars.findIndex((c) => /\p{L}/u.test(c) && ++letter === hint.index);
    if (at < 0 || toComparable(chars[at]!) !== hint.expected) return w;
    return (
      <span key={wi}>
        {chars.slice(0, at).join("")}
        <mark>{chars[at]}</mark>
        {chars.slice(at + 1).join("")}
      </span>
    );
  });
  return <Ba>{parts}</Ba>;
}

/** Строка листа, которая в режиме «Пчёлка» не показывается: меньше текста для 1–4 класса (docs/05 §7). */
const Extra = ({ children }: { children: ReactNode }) => <p className="feedback-extra">{children}</p>;

/**
 * «Почему так?» — объяснение ошибки (docs/04-ai-gigachat.md сценарий 1): текст готовит GigaChat через ai-gateway
 * (с меткой «Подсказку подготовил ИИ»), при недоступности — методический шаблон. Лимит и 429 на сервере: здесь
 * показываем честную причину, урок не прерывается.
 */
function AiExplain({ runId, attemptId }: { runId: string; attemptId: string }) {
  const t = useT();
  const [state, setState] = useState<{ loading: boolean; failed: boolean; text: string | null; source: "ai" | "template" | null }>({
    loading: false,
    failed: false,
    text: null,
    source: null,
  });

  const load = () => {
    setState({ loading: true, failed: false, text: null, source: null });
    learnApi.explain(runId, attemptId).then(
      (explanation) => setState({ loading: false, failed: false, text: explanation.text, source: explanation.source }),
      () => setState({ loading: false, failed: true, text: null, source: null }),
    );
  };

  if (state.failed) return <p className="feedback-explain feedback-explain--down">{t("Подсказка сейчас недоступна.")}</p>;
  if (!state.text) {
    return (
      <div className="feedback-explain">
        <Button small variant="secondary" loading={state.loading} onClick={load}>
          {t("Почему так?")}
        </Button>
      </div>
    );
  }
  return (
    <div className="feedback-explain">
      <p className="feedback-explain__text">{state.text}</p>
      {state.source === "ai" ? (
        <span className="feedback-explain__ai">
          <Sparkle weight="fill" aria-hidden />
          {t("Подсказку подготовил ИИ · GigaChat")}
        </span>
      ) : null}
    </div>
  );
}

/** «Верно!» и огонёк «N подряд», когда верных ответов подряд от трёх. */
function OkTitle({ index, combo }: { index: number; combo: number }) {
  const t = useT();
  const titles = [t("Верно!"), t("Точно!")];
  return (
    <>
      {titles[index % titles.length]}
      {combo >= COMBO_FROM ? (
        <span className="combo">
          <Fire weight="fill" aria-hidden />
          {t("{n} подряд", { n: combo })}
        </span>
      ) : null}
    </>
  );
}

function Feedback({
  exercise,
  result,
  answer,
  runId,
  retryLater,
  index,
  combo,
  explain,
  onNext,
}: {
  exercise: Exercise;
  result: AttemptResult;
  answer: Answer | null;
  /** Объяснение ошибки уходит в забег этой попытки (POST /lesson-runs/{runId}/attempts/{attemptId}/explanation). */
  runId: string;
  retryLater: boolean;
  index: number;
  combo: number;
  /** Кнопка «Почему так?» под ошибкой. */
  explain: boolean;
  onNext: () => void;
}) {
  const t = useT();
  const correct = result.correctAnswer?.text ?? "";
  const audio = result.correctAnswer?.audio;
  if (exercise.type === "match_pairs") {
    const links = new Map(answer?.type === "pairs" ? answer.pairs.map((l) => [l.left, l.right]) : []);
    return result.verdict === "wrong" ? (
      <FeedbackSheet tone="bad" title={t("Пока не так")} actionLabel={t("Дальше")} onAction={onNext}>
        <p>{t("Правильно так:")}</p>
        <PairsFix exercise={exercise} result={result} links={links} />
        {retryLater ? <Extra>{t("Повторим в конце урока.")}</Extra> : null}
      </FeedbackSheet>
    ) : (
      <FeedbackSheet tone="ok" title={<OkTitle index={index} combo={combo} />} actionLabel={t("Дальше")} onAction={onNext} />
    );
  }
  // У выбора правильный ответ — русский вариант, у плиток и ввода — башкирская фраза.
  const option = exercise.type === "choice_ba_ru" ? exercise.options.find((o) => o.id === result.correctOptionId)?.textRu ?? result.meaningRu : undefined;
  const answerText = exercise.type === "choice_ba_ru" ? (option ? <b>{option}</b> : null) : correct ? <Ba>{correct}</Ba> : null;
  const meaningRu = (result.meaningRu ?? ("promptRu" in exercise ? exercise.promptRu : "")).replace(/[.!?]+$/, "");
  const meaning =
    exercise.type === "choice_ba_ru" ? (
      option ? (
        <p>
          <Ba>{exercise.prompt}</Ba> — «{option}»
        </p>
      ) : null
    ) : exercise.type === "duel" || !correct ? null : (
      <WithListen audio={audio} word={correct}>
        <p>
          <Ba>{correct}</Ba> — «{meaningRu}»
        </p>
      </WithListen>
    );

  switch (result.verdict) {
    case "correct":
      return (
        <FeedbackSheet tone="ok" title={<OkTitle index={index} combo={combo} />} actionLabel={t("Дальше")} onAction={onNext}>
          {meaning}
        </FeedbackSheet>
      );
    case "typo":
      return (
        <FeedbackSheet tone="ok" title={t("Верно, но с опечаткой")} actionLabel={t("Дальше")} onAction={onNext}>
          {answerText ? (
            <WithListen audio={audio} word={correct}>
              <p>
                {t("Правильно:")} {answerText}
              </p>
            </WithListen>
          ) : null}
          {explain ? <AiExplain runId={runId} attemptId={result.attemptId} /> : null}
        </FeedbackSheet>
      );
    case "almost":
      // Засчитано, но одна башкирская буква заменена похожей русской: показываем слово с этой буквой.
      return (
        <FeedbackSheet tone="almost" title={t("Почти!")} art={illustrations.beeSurprise} actionLabel={t("Дальше")} onAction={onNext}>
          {correct ? (
            <p className="feedback-answer">
              <HintedAnswer text={correct} hint={result.hint} />
            </p>
          ) : null}
          {result.hint ? (
            result.hint.got && result.hint.got !== result.hint.expected ? (
              <p>{t("Засчитано. Здесь пишется «{expected}», а не «{got}».", { expected: result.hint.expected, got: result.hint.got })}</p>
            ) : (
              <p>{t("Засчитано. Здесь пишется «{expected}».", { expected: result.hint.expected })}</p>
            )
          ) : (
            <p>{t("Засчитано. Сравни со своим ответом.")}</p>
          )}
          {explain ? <AiExplain runId={runId} attemptId={result.attemptId} /> : null}
        </FeedbackSheet>
      );
    case "wrong":
      return (
        <FeedbackSheet tone="bad" title={t("Пока не так")} actionLabel={t("Дальше")} onAction={onNext}>
          {answerText ? (
            <WithListen audio={audio} word={correct}>
              <p>
                {t("Правильно:")} {answerText}
              </p>
            </WithListen>
          ) : null}
          {explain ? <AiExplain runId={runId} attemptId={result.attemptId} /> : null}
          {retryLater ? <Extra>{t("Повторим в конце урока.")}</Extra> : null}
        </FeedbackSheet>
      );
    case "recorded":
      return (
        <FeedbackSheet tone="voted" title={t("Голос учтён")} art={illustrations.beeCheer} actionLabel={t("Дальше")} onAction={onNext}>
          <p>{t("Итог появится в профиле.")}</p>
        </FeedbackSheet>
      );
  }
}

/** «Уже уходишь?» (prototype 12-lesson-quit): лист с пчелой, «Остаться» — основное действие. */
function QuitDialog({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onStay}
      title={t("Уже уходишь?")}
      description={t("Урок начнётся сначала.")}
      art={illustrations.beeSympathy}
      centered
      hideClose
      actions={
        <>
          <Button block onClick={onStay}>
            {t("Остаться")}
          </Button>
          <LinkButton tone="danger" onClick={onLeave}>
            {t("Выйти")}
          </LinkButton>
        </>
      }
    />
  );
}

/** Урок открывается: тот же каркас, вместо задания — скелетон. */
export function LessonLoading({ onLeave }: { onLeave: () => void }) {
  const t = useT();
  return (
    <div className="lesson">
      <header className="lesson__head">
        <div className="tt-column lesson__head-inner">
          <IconButton label={t("Выйти из урока")} icon={<X weight="bold" />} onClick={onLeave} />
          <ProgressBar value={0} max={100} label={t("Прогресс урока")} valueText="0%" />
        </div>
      </header>
      <main id="main" className="lesson__body">
        <div className="tt-column lesson__column">
          <SkeletonGroup label={t("Открываем урок")} className="tt-stack">
            <Skeleton width={140} height={30} radius="button" />
            <Skeleton width="80%" height={30} />
            <Skeleton height={120} radius="card" />
            <Skeleton height={60} radius="button" />
          </SkeletonGroup>
        </div>
      </main>
    </div>
  );
}

/** Итог урока сохраняется; при сбое — «Что-то пошло не так» с повтором (тот же runId: сервер не начислит дважды). */
export function LessonSaving({ failed, onRetry, onLeave }: { failed?: boolean; onRetry: () => void; onLeave: () => void }) {
  const t = useT();
  return (
    <div className="lesson lesson--center">
      <main id="main" className="lesson__body">
        <div className="tt-column lesson__column lesson__column--center">
          {failed ? (
            <EmptyState
              art="emptyError"
              title={t("Итог не сохранился")}
              role="alert"
              actions={
                <>
                  <Button block onClick={onRetry}>
                    {t("Попробовать ещё раз")}
                  </Button>
                  <LinkButton tone="neutral" onClick={onLeave}>
                    {t("На тропу")}
                  </LinkButton>
                </>
              }
            >
              {t("Проверь интернет. Ответы не пропадут.")}
            </EmptyState>
          ) : (
            <SkeletonGroup label={t("Сохраняем урок")} className="tt-stack lesson__saving">
              <Skeleton width={220} height={220} radius="card" />
              <Skeleton width="60%" height={30} />
            </SkeletonGroup>
          )}
        </div>
      </main>
    </div>
  );
}
