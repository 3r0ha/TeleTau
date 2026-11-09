import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import {
  computeAchievements,
  FSRS_VERSION,
  ratingFromVerdicts,
  reviewCard,
  srsStatus,
  ufaDate,
  type AchievementState,
  type DuelChoice,
  type GradedVerdict,
  type SrsCard,
  type Verdict,
} from "@teletau/domain-rules";
import { and, asc, count, eq, inArray, lte, sql } from "drizzle-orm";
import type { Principal } from "../../common/auth.js";
import { ApiError, conflict, invalidField, notFound, unprocessable } from "../../common/problem.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { AssignmentsService } from "../assignments/index.js";
import { ConsensusService, type DuelCard, type Voter } from "../consensus/index.js";
import { ContentService, type WordContent } from "../content/index.js";
import { CorpusService } from "../corpus/index.js";
import { ProgressService } from "../progress/index.js";
import {
  achievementsInput,
  coursePlaces,
  myAchievements,
  newlyEarned,
  type CompletedRun,
} from "./achievements.js";
import type { LearningApi } from "./learning.api.js";
import { attempts, lessonRuns, srsCards, srsReviews } from "./learning.schema.js";
import { jumpExercises, jumpOutcome, JUMP_MISTAKES_ALLOWED, JUMP_TITLE_RU } from "./jump.js";
import { lessonPreview } from "./lesson-preview.js";
import { buildReviewPlan, REVIEW_LESSON_ID, type DueWord } from "./review-plan.js";
import {
  buildPlan,
  checkAnswer,
  isAnswerable,
  isCredited,
  lessonDuelsAllowed,
  shouldRetry,
  wordVerdicts,
  type PlanItem,
  type RunPlan,
} from "./run-plan.js";
import { buildTrail, findNode, jumpScope, lessonsPassed } from "./trail.js";

type RunRow = typeof lessonRuns.$inferSelect;
type FirstAttempt = {
  id: string;
  runExerciseId: string;
  verdict: Verdict;
  answer: unknown;
  hintsUsed: number;
};
type CardRow = typeof srsCards.$inferSelect;
/** Что правилам наград нужно из контента: места курса и слова словаря. */
type AchievementScope = { places: ReturnType<typeof coursePlaces>; known: ReadonlySet<string> };

const cardOf = (c: CardRow): SrsCard => ({
  stability: c.stability,
  difficulty: c.difficulty,
  reps: c.reps,
  lapses: c.lapses,
  lastReviewOn: c.lastReviewOn,
  dueOn: c.dueOn,
});

/** Сколько подсказок к условию у упражнения забега (у плиток и ввода в уроке). */
const hintCount = (item: PlanItem): number =>
  "hints" in item.view ? (item.view.hints?.length ?? 0) : 0;

/** 501 от модуля, который ещё не реализован: дуэлей нет, урок идёт без них. */
const isNotImplemented = (e: unknown) => e instanceof ApiError && e.status === 501;

/**
 * Тропа, забеги уроков и попытки (таблицы learning.schema.ts). Ответ проверяется на сервере по плану забега
 * (run-plan.ts, matchAnswer из @teletau/bashkir-text); ключи ответов клиенту не уходят. Голос в дуэли урока —
 * ConsensusService.recordVote в транзакции попытки (judgmentId = attemptId). Итог — мёд и серия через ProgressService
 * в транзакции завершения. Чужой забег неотличим от несуществующего (404).
 */
@Injectable()
export class LearningService implements LearningApi {
  constructor(
    @Inject(DB) protected readonly db: Db,
    protected readonly content: ContentService,
    protected readonly corpus: CorpusService,
    protected readonly consensus: ConsensusService,
    protected readonly progress: ProgressService,
    protected readonly assignments: AssignmentsService,
  ) {}

  async course(principal: Principal, now: Date = new Date()): Promise<Schema<"Course">> {
    const [course, completions, skipped, lexicon, assigned] = await Promise.all([
      this.content.course(),
      this.progress.lessonCompletions(principal.accountId),
      this.progress.lessonSkips(principal.accountId),
      this.content.words(),
      this.assignments.forStudent(principal, now),
    ]);
    const due = await this.dueWords(
      principal.accountId,
      now,
      new Set(lexicon.words.map((w) => w.id)),
    );
    // Заданный учителем узел открыт сразу (ADR 0021): задание можно выполнить, не дожидаясь своей очереди на тропе.
    const open = new Set(assigned.flatMap((a) => (a.lessonId ? [a.lessonId] : [])));
    return {
      ...buildTrail(course, completions, open, skipped),
      review: { due: due.length },
      ...(assigned.length ? { assignments: assigned } : {}),
    };
  }

  async startReview(
    principal: Principal,
    body: Schema<"StartLessonRunRequest">,
    now: Date = new Date(),
  ): Promise<Schema<"LessonRun">> {
    const existing = await this.findRun(body.runId);
    if (existing) return this.replayStart(existing, principal, REVIEW_LESSON_ID);
    const lexicon = await this.content.words();
    const known = new Set(lexicon.words.map((w) => w.id));
    let due = await this.dueWords(principal.accountId, now, known);
    // Учитель задал «Повторить слова», а срок ни одного слова не наступил — повторяем ближайшие по сроку (FSRS-6
    // учитывает раннее повторение): задание выполнимо в любой день.
    if (
      due.length === 0 &&
      (await this.assignments.forStudent(principal, now)).some(
        (a) => a.kind === "review" && !a.done,
      )
    ) {
      due = await this.soonestWords(principal.accountId, known);
    }
    const plan = buildReviewPlan({ due, lexicon: lexicon.words });
    const [inserted] = await this.db
      .insert(lessonRuns)
      .values({
        id: body.runId,
        accountId: principal.accountId,
        lessonId: REVIEW_LESSON_ID,
        kind: "review",
        contentVersion: lexicon.contentVersion,
        plan,
        startedAt: now,
      })
      .onConflictDoNothing({ target: lessonRuns.id })
      .returning();
    if (inserted) return this.runView(inserted);
    return this.replayStart((await this.findRun(body.runId))!, principal, REVIEW_LESSON_ID);
  }

  async startJump(
    principal: Principal,
    unitId: string,
    body: Schema<"StartLessonRunRequest">,
    now: Date = new Date(),
  ): Promise<Schema<"LessonRun">> {
    const existing = await this.findRun(body.runId);
    if (existing) {
      if (existing.kind !== "jump") throw conflict("run_conflict");
      return this.replayStart(existing, principal, unitId);
    }
    const trail = await this.course(principal, now);
    const unit = trail.units.find((u) => u.id === unitId);
    if (!unit) throw notFound();
    if (!unit.jump) throw conflict("jump_unavailable");
    // Задания — из «Испытаний» мест перед этим, где остались непройденные уроки (jump.ts); без подсказок и карточек.
    const tests = (
      await Promise.all(jumpScope(trail, unitId).tests.map((id) => this.content.lesson(id)))
    ).flatMap((l) => (l ? [l] : []));
    const plan = buildPlan({
      unitId,
      titleRu: JUMP_TITLE_RU,
      newWords: [],
      exercises: jumpExercises(tests.map((t) => t.exercises)),
      duels: new Map(),
    });
    const [inserted] = await this.db
      .insert(lessonRuns)
      .values({
        id: body.runId,
        accountId: principal.accountId,
        lessonId: unitId,
        kind: "jump",
        contentVersion: tests[0]?.contentVersion ?? trail.contentVersion,
        plan,
        startedAt: now,
      })
      .onConflictDoNothing({ target: lessonRuns.id })
      .returning();
    if (inserted) return this.runView(inserted);
    return this.replayStart((await this.findRun(body.runId))!, principal, unitId);
  }

  async words(principal: Principal, now: Date = new Date()): Promise<Schema<"MyWords">> {
    const [lexicon, cards] = await Promise.all([
      this.content.words(),
      this.db.select().from(srsCards).where(eq(srsCards.accountId, principal.accountId)),
    ]);
    const byWord = new Map(cards.map((c) => [c.wordId, c]));
    const today = ufaDate(now);
    const list: Schema<"MyWord">[] = lexicon.words.flatMap((w) => {
      const card = byWord.get(w.id);
      if (!card) return [];
      return [
        {
          id: w.id,
          word: w.word,
          translationRu: w.translationRu,
          status: srsStatus({ dueOn: card.dueOn, today }),
          ...(w.sources.length ? { sources: w.sources } : {}),
        },
      ];
    });
    // Сначала «пора повторить», затем по порядку курса (сортировка устойчива).
    list.sort((a, b) => (a.status === b.status ? 0 : a.status === "review" ? -1 : 1));
    const review = list.filter((w) => w.status === "review").length;
    return { summary: { total: list.length, learned: list.length - review, review }, words: list };
  }

  async achievements(
    principal: Principal,
    now: Date = new Date(),
  ): Promise<Schema<"MyAchievements">> {
    return myAchievements(
      await this.achievementStates(
        this.db,
        principal.accountId,
        now,
        await this.achievementScope(),
      ),
    );
  }

  async preview(lessonId: string): Promise<Schema<"LessonPreview">> {
    const [course, lesson, lexicon] = await Promise.all([
      this.content.course(),
      this.content.lesson(lessonId),
      this.content.words(),
    ]);
    const unit = lesson ? course.units.find((u) => u.id === lesson.unitId) : undefined;
    if (!lesson || !unit) throw notFound();
    return lessonPreview(lesson, unit, lexicon);
  }

  async startRun(
    principal: Principal,
    lessonId: string,
    body: Schema<"StartLessonRunRequest">,
    now: Date = new Date(),
  ): Promise<Schema<"LessonRun">> {
    const existing = await this.findRun(body.runId);
    if (existing) return this.replayStart(existing, principal, lessonId);

    const trail = await this.course(principal, now);
    const found = findNode(trail, lessonId);
    if (!found) throw notFound();
    if (found.node.state === "locked") throw conflict("lesson_locked");
    const lesson = await this.content.lesson(lessonId);
    if (!lesson) throw notFound();

    const voter: Voter = {
      accountId: principal.accountId,
      kind: principal.kind,
      roles: principal.roles,
    };
    const duels = new Map<string, DuelCard>();
    let extraDuels: DuelCard[] = [];
    if (lesson.kind === "help_language") {
      extraDuels = await this.pickDuels(voter, lesson.unitId, lesson.exerciseCount);
    } else if (lessonDuelsAllowed(lessonsPassed(trail))) {
      // Дуэль в уроке — только с третьего урока ученика (LESSONS_BEFORE_DUELS, docs/02 §3); раньше упражнения duel
      // пропускаются, как при исчерпанном пуле. Дуэль по ссылке: уже голосовал, вариант отклонён носителем или дуэли нет — упражнение пропускается (не подменяется
      // другой дуэлью). Без ссылки — из пула юнита без повторов своих голосов; пул исчерпан — тоже пропуск.
      const duelExercises = lesson.exercises.filter((e) => e.type === "duel");
      const taken = new Set<string>();
      for (const e of duelExercises.filter((d) => d.duelRef)) {
        const card = await this.duelByRef(voter, e.duelRef!);
        if (card && !taken.has(card.itemId)) {
          duels.set(e.id, card);
          taken.add(card.itemId);
        }
      }
      const unassigned = duelExercises.filter((d) => !d.duelRef);
      if (unassigned.length > 0) {
        const pool = (
          await this.pickDuels(voter, lesson.unitId, unassigned.length + taken.size)
        ).filter((c) => !taken.has(c.itemId));
        unassigned.forEach((e, i) => pool[i] && duels.set(e.id, pool[i]));
      }
    }
    // Новые слова сначала показываются (карточки «Новое слово» — клиентам, которые их умеют). Подсказки к условию — всем,
    // но только в уроке: «Испытание места» проверяет без подсказок.
    const lexicon = await this.content.words();
    const introWords = body.accepts?.includes("word_intro")
      ? await this.unmetWords(principal.accountId, lesson.wordIds ?? [], lexicon.words)
      : [];
    const plan = buildPlan({
      unitId: lesson.unitId,
      titleRu: lesson.titleRu,
      newWords: lesson.newWords,
      wordIds: lesson.wordIds,
      exercises: lesson.exercises,
      duels,
      extraDuels,
      introWords,
      ...(lesson.kind === "lesson" ? { lexicon: lexicon.words } : {}),
    });

    const [inserted] = await this.db
      .insert(lessonRuns)
      .values({
        id: body.runId,
        accountId: principal.accountId,
        lessonId,
        kind: lesson.kind,
        contentVersion: lesson.contentVersion,
        plan,
        startedAt: now,
      })
      .onConflictDoNothing({ target: lessonRuns.id })
      .returning();
    if (inserted) return this.runView(inserted);
    // Тот же runId пришёл параллельно — ответ как на повтор.
    return this.replayStart((await this.findRun(body.runId))!, principal, lessonId);
  }

  async submitAttempt(
    principal: Principal,
    runId: string,
    body: Schema<"AttemptRequest">,
    now: Date = new Date(),
  ): Promise<Schema<"AttemptResult">> {
    try {
      return await this.db.transaction(async (tx) => {
        const run = await this.lockRun(tx, principal, runId);
        const [replay] = await tx.select().from(attempts).where(eq(attempts.id, body.attemptId));
        if (replay) {
          if (replay.runId !== run.id || replay.runExerciseId !== body.exerciseId)
            throw invalidField("/attemptId", "Этот attemptId уже использован для другого ответа");
          return replay.result as Schema<"AttemptResult">;
        }
        if (run.status === "completed") throw conflict("run_completed");
        const plan = run.plan as RunPlan;
        const item = plan.items.find((i) => i.id === body.exerciseId);
        if (!item) throw unprocessable("exercise_not_in_run");
        const checked = checkAnswer(item, body.answer);
        // Открытые подсказки к условию — не больше, чем их у упражнения: с подсказкой слово идёт в повторение не выше Hard.
        const hintsUsed = Math.min(body.hintsUsed ?? 0, hintCount(item));
        // Попытки по упражнению до этой: первая решает мёд и голос, их число — вернётся ли упражнение (shouldRetry).
        const [prior] = await tx
          .select({ n: count() })
          .from(attempts)
          .where(and(eq(attempts.runId, run.id), eq(attempts.runExerciseId, item.id)));
        const priorAttempts = prior?.n ?? 0;
        const firstAttempt = priorAttempts === 0;

        if (item.key.type === "duel" && firstAttempt) {
          const choice = (body.answer as Schema<"DuelAnswer">).choice;
          await this.recordVote(tx, principal, run, item, choice, body, now);
        }
        // Повторение: первая попытка обновляет карточки слов упражнения (FSRS-6).
        if (run.kind === "review" && firstAttempt)
          await this.reviewWords(
            tx,
            principal.accountId,
            run.id,
            body.attemptId,
            wordVerdicts(item, checked),
            hintsUsed > 0,
            now,
          );
        // Испытание для перехода: ошибки не повторяются, а больше JUMP_MISTAKES_ALLOWED ошибок — конец испытания.
        const jump = run.kind === "jump";
        const runEnded =
          jump && (await this.jumpOver(tx, run, plan, firstAttempt ? checked.verdict : undefined));
        const result: Schema<"AttemptResult"> = {
          attemptId: body.attemptId,
          exerciseId: item.id,
          verdict: checked.verdict,
          firstAttempt,
          retry: !jump && shouldRetry(checked.verdict, priorAttempts),
          ...(runEnded ? { runEnded: true } : {}),
          ...(checked.correctAnswer ? { correctAnswer: checked.correctAnswer } : {}),
          ...(checked.correctOptionId ? { correctOptionId: checked.correctOptionId } : {}),
          ...(checked.meaningRu ? { meaningRu: checked.meaningRu } : {}),
          ...(checked.hint ? { hint: checked.hint } : {}),
          ...(checked.correctPairs ? { correctPairs: checked.correctPairs } : {}),
        };
        await tx.insert(attempts).values({
          id: body.attemptId,
          runId: run.id,
          accountId: principal.accountId,
          runExerciseId: item.id,
          exerciseId: item.exerciseId ?? null,
          answer: body.answer,
          verdict: checked.verdict,
          firstAttempt,
          latencyMs: body.latencyMs ?? null,
          hintsUsed,
          result,
          createdAt: now,
        });
        return result;
      });
    } catch (e) {
      // attemptId занят попыткой другого забега или аккаунта.
      if (pgErrorCode(e) === "23505")
        throw invalidField("/attemptId", "Этот attemptId уже использован");
      throw e;
    }
  }

  async complete(
    principal: Principal,
    runId: string,
    now: Date = new Date(),
  ): Promise<Schema<"LessonRunSummary">> {
    return this.db.transaction(async (tx) => {
      // Завершения одного аккаунта — по очереди: номер прохождения за сутки, серия и лига без гонок.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`teletau:learning-complete:${principal.accountId}`}, 0))`,
      );
      const run = await this.lockRun(tx, principal, runId);
      if (run.status === "completed") return run.summary as Schema<"LessonRunSummary">;
      const plan = run.plan as RunPlan;
      const firsts = await tx
        .select({
          id: attempts.id,
          runExerciseId: attempts.runExerciseId,
          verdict: attempts.verdict,
          answer: attempts.answer,
          hintsUsed: attempts.hintsUsed,
        })
        .from(attempts)
        .where(and(eq(attempts.runId, run.id), eq(attempts.firstAttempt, true)));
      const byItem = new Map(firsts.map((a) => [a.runExerciseId, a]));
      // Карточкам «Новое слово» ответ не нужен: на мёд, точность и повторение они не влияют.
      const answerable = plan.items.filter(isAnswerable);
      if (run.kind === "jump") return this.completeJump(tx, principal, run, plan, byItem, now);
      if (answerable.some((i) => !byItem.has(i.id))) throw conflict("run_incomplete");

      // Награды до забега: его голоса уже записаны попытками — в «до» они не входят.
      const scope = await this.achievementScope();
      const runVotes = new Set(
        plan.items.flatMap((i) =>
          i.key.type === "duel" && byItem.has(i.id) ? [byItem.get(i.id)!.id] : [],
        ),
      );
      const before = await this.achievementStates(tx, principal.accountId, now, scope, {
        skipVotes: runVotes,
      });

      const today = ufaDate(now);
      const firstAttempts: Verdict[] = answerable.map((i) => byItem.get(i.id)!.verdict);
      const graded = answerable
        .filter((i) => i.key.type !== "duel")
        .map((i) => byItem.get(i.id)!.verdict);
      const accuracy = graded.length === 0 ? 1 : graded.filter(isCredited).length / graded.length;
      const [done] = await tx
        .select({ n: count() })
        .from(lessonRuns)
        .where(
          and(
            eq(lessonRuns.accountId, principal.accountId),
            eq(lessonRuns.lessonId, run.lessonId),
            eq(lessonRuns.status, "completed"),
            eq(lessonRuns.completedOn, today),
          ),
        );
      const completionToday = (done?.n ?? 0) + 1;

      const result = await this.progress.recordLessonCompletion(tx, {
        accountId: principal.accountId,
        accountKind: principal.kind,
        runId: run.id,
        lessonId: run.lessonId,
        kind: run.kind,
        firstAttempts,
        accuracy,
        newWords: plan.newWords.length,
        completionToday,
        completedAt: now,
      });
      const votes = plan.items
        .filter((i) => i.key.type === "duel")
        .map((i) => byItem.get(i.id)!)
        .filter((a) => (a.answer as Schema<"DuelAnswer">).choice !== "skip");
      const pendingFromVotes = await this.progress.pendingHoney(
        principal.accountId,
        votes.map((v) => v.id),
        tx,
      );
      // Задания учителя (ADR 0021): прохождение урока или повторения засчитывается в той же транзакции.
      await this.assignments.recordCompletion(tx, {
        principal,
        runId: run.id,
        kind: run.kind,
        lessonId: run.lessonId,
        at: now,
      });
      // Слова урока попадают в повторение: знакомство с оценкой по первым попыткам упражнений со словом.
      if (run.kind === "lesson" || run.kind === "place_test")
        await this.introduceWords(tx, principal.accountId, run, plan, byItem, now);
      const newAchievements = newlyEarned(
        before,
        await this.achievementStates(tx, principal.accountId, now, scope, {
          run: {
            kind: run.kind,
            lessonId: run.lessonId,
            on: today,
            goalReached: result.dailyGoalReached,
            firstAttempts,
          },
        }),
      );

      const summary: Schema<"LessonRunSummary"> = {
        runId: run.id,
        lessonId: run.lessonId,
        honey: { ...result.honey, pendingFromVotes },
        accuracy: Math.round(accuracy * 1000) / 1000,
        durationSeconds: Math.max(0, Math.round((now.getTime() - run.startedAt.getTime()) / 1000)),
        newWords: plan.newWords,
        votes: votes.length,
        streak: result.streak,
        ...(result.leagueResult ? { leagueResult: result.leagueResult } : {}),
        dailyGoal: result.dailyGoal,
        dailyGoalReached: result.dailyGoalReached,
        ...(newAchievements.length ? { newAchievements } : {}),
      };
      await tx
        .update(lessonRuns)
        .set({
          status: "completed",
          completedAt: now,
          completedOn: today,
          completionIndex: completionToday,
          accuracy,
          summary,
        })
        .where(eq(lessonRuns.id, run.id));
      return summary;
    });
  }

  // ── внутреннее ──

  /** Испытание для перехода уже не сдать: вместе с ответом `next` (первая попытка) ошибок больше, чем можно. */
  private async jumpOver(
    tx: Db,
    run: RunRow,
    plan: RunPlan,
    next: Verdict | undefined,
  ): Promise<boolean> {
    const rows = await tx
      .select({ verdict: attempts.verdict })
      .from(attempts)
      .where(and(eq(attempts.runId, run.id), eq(attempts.firstAttempt, true)));
    const verdicts = [...rows.map((r) => r.verdict), ...(next ? [next] : [])];
    return jumpOutcome(verdicts, plan.items.filter(isAnswerable).length).over;
  }

  /**
   * Итог испытания для перехода (docs/02 §2). Сдано — мёд, сота и день серии как за «Испытание места» (ProgressService),
   * непройденные уроки мест перед юнитом засчитываются (recordSkips), их слова уходят в повторение: проверенные в
   * испытании — по ответу, остальные — Good. Задания учителя испытание не выполняет: там нужен сам урок. Не сдано —
   * ничего не меняется: ни мёда, ни серии, ни отметок, ни карточек слов. Досрочно (ошибок больше, чем можно) — можно
   * завершить, не ответив на все задания.
   */
  private async completeJump(
    tx: Db,
    principal: Principal,
    run: RunRow,
    plan: RunPlan,
    byItem: ReadonlyMap<string, FirstAttempt>,
    now: Date,
  ): Promise<Schema<"LessonRunSummary">> {
    const answerable = plan.items.filter(isAnswerable);
    const answered = answerable.flatMap((i) =>
      byItem.has(i.id) ? [byItem.get(i.id)!.verdict] : [],
    );
    const outcome = jumpOutcome(answered, answerable.length);
    if (!outcome.passed && !outcome.over) throw conflict("run_incomplete");
    const today = ufaDate(now);
    const accuracy =
      answerable.length === 0 ? 1 : answered.filter(isCredited).length / answerable.length;
    const todays = await tx
      .select({
        passed: sql<boolean>`coalesce((${lessonRuns.summary} -> 'jump' ->> 'passed')::boolean, false)`,
      })
      .from(lessonRuns)
      .where(
        and(
          eq(lessonRuns.accountId, principal.accountId),
          eq(lessonRuns.lessonId, run.lessonId),
          eq(lessonRuns.status, "completed"),
          eq(lessonRuns.completedOn, today),
        ),
      );
    const jump = {
      unitId: run.lessonId,
      passed: outcome.passed,
      mistakes: outcome.mistakes,
      mistakesAllowed: JUMP_MISTAKES_ALLOWED,
    };
    const base = {
      runId: run.id,
      lessonId: run.lessonId,
      accuracy: Math.round(accuracy * 1000) / 1000,
      durationSeconds: Math.max(0, Math.round((now.getTime() - run.startedAt.getTime()) / 1000)),
      newWords: [],
      votes: 0,
    };
    let summary: Schema<"LessonRunSummary">;
    if (outcome.passed) {
      // Что открывается — по тропе на момент сдачи: уже пройденное (или открытое другим испытанием) не трогаем.
      const { skips } = jumpScope(await this.course(principal, now), run.lessonId);
      const scope = await this.achievementScope();
      const before = await this.achievementStates(tx, principal.accountId, now, scope);
      const result = await this.progress.recordLessonCompletion(tx, {
        accountId: principal.accountId,
        accountKind: principal.kind,
        runId: run.id,
        lessonId: run.lessonId,
        kind: "jump",
        firstAttempts: answered,
        accuracy,
        newWords: 0,
        // Множитель повтора мёда — по сданным испытаниям к этому месту за сутки: несданные мёда не стоят.
        completionToday: todays.filter((t) => t.passed).length + 1,
        completedAt: now,
      });
      await this.progress.recordSkips(tx, {
        accountId: principal.accountId,
        lessonIds: skips,
        runId: run.id,
        at: now,
      });
      const skipped = new Set(skips);
      const lexicon = await this.content.words();
      const words = lexicon.words.filter((w) => skipped.has(w.lessonId)).map((w) => w.id);
      await this.introduceWords(tx, principal.accountId, run, plan, byItem, now, words);
      const newAchievements = newlyEarned(
        before,
        await this.achievementStates(tx, principal.accountId, now, scope, {
          run: {
            kind: "jump",
            lessonId: run.lessonId,
            on: today,
            goalReached: result.dailyGoalReached,
            firstAttempts: answered,
          },
        }),
      );
      summary = {
        ...base,
        honey: { ...result.honey, pendingFromVotes: 0 },
        streak: result.streak,
        ...(result.leagueResult ? { leagueResult: result.leagueResult } : {}),
        dailyGoal: result.dailyGoal,
        dailyGoalReached: result.dailyGoalReached,
        jump,
        ...(newAchievements.length ? { newAchievements } : {}),
      };
    } else {
      const day = await this.progress.dayState(tx, principal.accountId, now);
      summary = {
        ...base,
        honey: { total: 0, base: 0, firstTry: 0, multiplier: 0, pendingFromVotes: 0 },
        streak: day.streak,
        dailyGoal: day.dailyGoal,
        dailyGoalReached: false,
        jump,
      };
    }
    await tx
      .update(lessonRuns)
      .set({
        status: "completed",
        completedAt: now,
        completedOn: today,
        completionIndex: todays.length + 1,
        accuracy,
        summary,
      })
      .where(eq(lessonRuns.id, run.id));
    return summary;
  }

  private async achievementScope(): Promise<AchievementScope> {
    const [course, lexicon] = await Promise.all([this.content.course(), this.content.words()]);
    return { places: coursePlaces(course), known: new Set(lexicon.words.map((w) => w.id)) };
  }

  /**
   * Награды аккаунта по его истории (achievements.ts): завершённые забеги с вердиктами первых попыток, день первого
   * знакомства с каждым словом словаря, факты progress. `run` — забег, который ещё завершается в этой транзакции;
   * `skipVotes` — голоса, которые не считать.
   */
  private async achievementStates(
    db: Db,
    accountId: string,
    now: Date,
    scope: AchievementScope,
    extra: { run?: CompletedRun; skipVotes?: ReadonlySet<string> } = {},
  ): Promise<AchievementState[]> {
    // По очереди: db бывает транзакцией (одно соединение).
    const runs = await db
      .select({
        kind: lessonRuns.kind,
        lessonId: lessonRuns.lessonId,
        on: sql<string>`${lessonRuns.completedOn}::text`,
        goalReached: sql<boolean>`coalesce((${lessonRuns.summary} ->> 'dailyGoalReached')::boolean, false)`,
        firstAttempts: sql<
          Verdict[]
        >`coalesce(array_agg(${attempts.verdict}::text) FILTER (WHERE ${attempts.id} IS NOT NULL), '{}')`,
      })
      .from(lessonRuns)
      .leftJoin(attempts, and(eq(attempts.runId, lessonRuns.id), eq(attempts.firstAttempt, true)))
      .where(and(eq(lessonRuns.accountId, accountId), eq(lessonRuns.status, "completed")))
      .groupBy(lessonRuns.id);
    const words = await db
      .select({
        wordId: srsCards.wordId,
        on: sql<string>`coalesce(min(${srsReviews.reviewedOn}), ${srsCards.lastReviewOn})::text`,
      })
      .from(srsCards)
      .leftJoin(
        srsReviews,
        and(eq(srsReviews.accountId, srsCards.accountId), eq(srsReviews.wordId, srsCards.wordId)),
      )
      .where(eq(srsCards.accountId, accountId))
      .groupBy(srsCards.wordId, srsCards.lastReviewOn);
    const facts = await this.progress.achievementFacts(db, accountId);
    return computeAchievements(
      achievementsInput({
        today: ufaDate(now),
        places: scope.places,
        runs: extra.run ? [...runs, extra.run] : runs,
        words,
        known: scope.known,
        facts,
        ...(extra.skipVotes ? { skipVotes: extra.skipVotes } : {}),
      }),
    );
  }

  private async findRun(runId: string, db: Db = this.db): Promise<RunRow | undefined> {
    const [row] = await db.select().from(lessonRuns).where(eq(lessonRuns.id, runId));
    return row;
  }

  /** Забег вызывающего под блокировкой строки; чужой или несуществующий — 404. */
  private async lockRun(tx: Db, principal: Principal, runId: string): Promise<RunRow> {
    const [run] = await tx.select().from(lessonRuns).where(eq(lessonRuns.id, runId)).for("update");
    if (!run || run.accountId !== principal.accountId) throw notFound();
    return run;
  }

  private replayStart(run: RunRow, principal: Principal, lessonId: string): Schema<"LessonRun"> {
    if (run.accountId !== principal.accountId || run.lessonId !== lessonId)
      throw conflict("run_conflict");
    return this.runView(run);
  }

  private runView(run: RunRow): Schema<"LessonRun"> {
    const plan = run.plan as RunPlan;
    return {
      runId: run.id,
      lessonId: run.lessonId,
      kind: run.kind,
      titleRu: plan.titleRu,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      exercises: plan.items.map((i) => i.view),
    };
  }

  /** Слова со сроком повторения на сегодня (по Уфе), которые ещё есть в словаре курса: сначала самые просроченные. */
  private async dueWords(
    accountId: string,
    now: Date,
    known: ReadonlySet<string>,
  ): Promise<DueWord[]> {
    const rows = await this.db
      .select({ wordId: srsCards.wordId, reps: srsCards.reps, stability: srsCards.stability })
      .from(srsCards)
      .where(and(eq(srsCards.accountId, accountId), lte(srsCards.dueOn, ufaDate(now))))
      .orderBy(asc(srsCards.dueOn), asc(srsCards.stability));
    return rows.filter((r) => known.has(r.wordId));
  }

  /**
   * Слова урока, которых ученик ещё не встречал: нет карточки повторения (слово попадает в повторение, когда урок с ним
   * пройден). По порядку new_words; слова без строки словаря пропускаются.
   */
  private async unmetWords(
    accountId: string,
    wordIds: readonly string[],
    lexicon: readonly WordContent[],
  ): Promise<WordContent[]> {
    if (wordIds.length === 0) return [];
    const met = new Set(
      (
        await this.db
          .select({ wordId: srsCards.wordId })
          .from(srsCards)
          .where(and(eq(srsCards.accountId, accountId), inArray(srsCards.wordId, [...wordIds])))
      ).map((r) => r.wordId),
    );
    const byId = new Map(lexicon.map((w) => [w.id, w]));
    return wordIds.flatMap((id) => (met.has(id) ? [] : (byId.get(id) ?? [])));
  }

  /** Ближайшие по сроку слова (срок ещё не наступил) — повторение по заданию учителя. */
  private async soonestWords(accountId: string, known: ReadonlySet<string>): Promise<DueWord[]> {
    const rows = await this.db
      .select({ wordId: srsCards.wordId, reps: srsCards.reps, stability: srsCards.stability })
      .from(srsCards)
      .where(eq(srsCards.accountId, accountId))
      .orderBy(asc(srsCards.dueOn), asc(srsCards.stability));
    return rows.filter((r) => known.has(r.wordId));
  }

  /**
   * Знакомство со словами урока: новая карточка (FSRS-6) с худшей оценкой по первым попыткам (с подсказкой к условию —
   * не выше Hard, векторы srs/rating.json); есть карточка — не трогаем.
   */
  private async introduceWords(
    tx: Db,
    accountId: string,
    run: RunRow,
    plan: RunPlan,
    byItem: ReadonlyMap<string, FirstAttempt>,
    now: Date,
    wordIds: readonly string[] = plan.wordIds ?? [],
  ): Promise<void> {
    if (wordIds.length === 0) return;
    const verdicts = new Map<string, GradedVerdict[]>();
    const hinted = new Map<string, boolean[]>();
    for (const item of plan.items) {
      const attempt = byItem.get(item.id);
      if (!attempt || !item.words?.length) continue;
      const checked =
        item.key.type === "pairs"
          ? checkAnswer(item, attempt.answer as Schema<"AttemptAnswer">)
          : { verdict: attempt.verdict };
      for (const [w, v] of wordVerdicts(item, checked)) {
        verdicts.set(w, [...(verdicts.get(w) ?? []), v]);
        hinted.set(w, [...(hinted.get(w) ?? []), attempt.hintsUsed > 0]);
      }
    }
    const today = ufaDate(now);
    for (const wordId of wordIds) {
      const rating = ratingFromVerdicts({
        verdicts: verdicts.get(wordId) ?? [],
        hinted: hinted.get(wordId) ?? [],
      });
      const { card } = reviewCard(null, rating, today);
      const inserted = await tx
        .insert(srsCards)
        .values({ accountId, wordId, ...card, fsrsVersion: FSRS_VERSION })
        .onConflictDoNothing({ target: [srsCards.accountId, srsCards.wordId] })
        .returning({ wordId: srsCards.wordId });
      if (inserted.length === 0) continue;
      await tx
        .insert(srsReviews)
        .values({
          accountId,
          wordId,
          runId: run.id,
          rating,
          reviewedOn: today,
          reviewedAt: now,
          stability: card.stability,
          difficulty: card.difficulty,
          dueOn: card.dueOn,
          fsrsVersion: FSRS_VERSION,
        })
        .onConflictDoNothing({ target: [srsReviews.runId, srsReviews.wordId] });
    }
  }

  /**
   * Повторение: первая попытка упражнения → новая память слова (FSRS-6) и запись в журнал. Карточки нет — пропуск.
   * hinted — к условию открывали подсказку (в повторении их не бывает, но правило то же: не выше Hard).
   */
  private async reviewWords(
    tx: Db,
    accountId: string,
    runId: string,
    attemptId: string,
    verdicts: ReadonlyMap<string, GradedVerdict>,
    hinted: boolean,
    now: Date,
  ): Promise<void> {
    const today = ufaDate(now);
    for (const [wordId, verdict] of verdicts) {
      const [row] = await tx
        .select()
        .from(srsCards)
        .where(and(eq(srsCards.accountId, accountId), eq(srsCards.wordId, wordId)))
        .for("update");
      if (!row) continue;
      const rating = ratingFromVerdicts({ verdicts: [verdict], hinted: [hinted] });
      const r = reviewCard(cardOf(row), rating, today);
      await tx
        .update(srsCards)
        .set({ ...r.card, fsrsVersion: FSRS_VERSION, updatedAt: now })
        .where(and(eq(srsCards.accountId, accountId), eq(srsCards.wordId, wordId)));
      await tx
        .insert(srsReviews)
        .values({
          accountId,
          wordId,
          runId,
          attemptId,
          rating,
          reviewedOn: today,
          reviewedAt: now,
          ...(r.elapsedDays !== undefined ? { elapsedDays: r.elapsedDays } : {}),
          stability: r.card.stability,
          difficulty: r.card.difficulty,
          dueOn: r.card.dueOn,
          fsrsVersion: FSRS_VERSION,
        })
        .onConflictDoNothing({ target: [srsReviews.runId, srsReviews.wordId] });
    }
  }

  private async pickDuels(voter: Voter, unitId: string, n: number): Promise<DuelCard[]> {
    if (n <= 0) return [];
    try {
      return await this.consensus.pickDuels(voter, unitId, n);
    } catch (e) {
      if (isNotImplemented(e)) return [];
      throw e;
    }
  }

  private async duelByRef(voter: Voter, ref: string): Promise<DuelCard | undefined> {
    try {
      return await this.consensus.duelByRef(voter, ref);
    } catch (e) {
      if (isNotImplemented(e)) return undefined;
      throw e;
    }
  }

  /** Голос ребёнка или взрослого в дуэли урока. Уже голосовал за этот исходник (другой забег) — голос не пишется, ответ тот же. */
  private async recordVote(
    tx: Db,
    principal: Principal,
    run: RunRow,
    item: PlanItem,
    choice: DuelChoice,
    body: Schema<"AttemptRequest">,
    at: Date,
  ): Promise<void> {
    if (item.key.type !== "duel") return;
    const key = item.key;
    try {
      await tx.transaction((sp) =>
        this.consensus.recordVote(sp, {
          judgmentId: body.attemptId,
          voter: { accountId: principal.accountId, kind: principal.kind, roles: principal.roles },
          itemId: key.itemId,
          shown: key.shown,
          choice,
          context: "lesson",
          runId: run.id,
          ...(body.latencyMs !== undefined ? { latencyMs: body.latencyMs } : {}),
          at,
        }),
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === "already_voted") return;
      throw e;
    }
  }
}
