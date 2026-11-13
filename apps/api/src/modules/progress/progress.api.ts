// Публичный интерфейс модуля progress: мёд, серия, счётчики, прогресс класса (граф: progress → competition, org).
// Числа и правила — @teletau/domain-rules (векторы contracts/test-vectors/{xp,streak}). Вызовы — в транзакции вызывающего.
import type { Schema } from "@teletau/contracts";
import type { DuelChoice, DuelDecision, LessonHoney, NodeKind, Verdict } from "@teletau/domain-rules";
import type { AccountKind, Principal } from "../../common/auth.js";
import type { Db } from "../../db/database.js";

export interface LessonCompletionInput {
  accountId: string;
  accountKind: AccountKind;
  /** Забег (learning.lesson_runs.id) — ключ идемпотентности начисления. */
  runId: string;
  /** Узел тропы; у повторения — «review»; у испытания для перехода — id юнита. */
  lessonId: string;
  /**
   * Вид забега: узел тропы, review — повторение слов (мёд — как за урок, без прохождения узла) или jump — сданное
   * испытание для перехода (мёд — как за «Испытание места», без прохождения узла; уроки — recordSkips).
   */
  kind: NodeKind | "review" | "jump";
  /** Вердикты первых попыток всех упражнений забега (дуэли — recorded). */
  firstAttempts: Verdict[];
  /** Точность забега 0..1 (без дуэлей). */
  accuracy: number;
  /** Новых слов урока (для счётчика «слова»; учитываются при первом прохождении). */
  newWords: number;
  /** Номер этого завершения этого урока за сутки по Уфе (1 — первое): считает learning по своим забегам. */
  completionToday: number;
  completedAt: Date;
}

export interface LessonCompletionResult {
  honey: LessonHoney;
  /** Номер завершения этого урока за сутки по Уфе (1 — первое). */
  completionToday: number;
  streak: Schema<"StreakState">;
  /** Непросмотренный итог прошлой недели лиги (экран «Новая лига»). */
  leagueResult?: Schema<"LeagueResult">;
  /** Цель дня после этого забега. */
  dailyGoal: Schema<"DailyGoal">;
  /** Этот забег выполнил цель дня (до него она ещё не была выполнена). */
  dailyGoalReached: boolean;
}

export interface VoteSettlement {
  accountId: string;
  judgmentId: string;
  choice: DuelChoice;
}

/** Числа одного ученика для подсчётов кабинета министерства (ADR 0023); наружу API — только суммы по группам. */
export interface LearnerTotals {
  /** Уроков и повторений пройдено всего (activity_days). */
  lessonsTotal: number;
  /** То же за неделю. */
  lessonsWeek: number;
  /** Новых слов пройденных уроков (счётчик «слова»). */
  wordsLearned: number;
}

/** Числа одного ученика для публичной доски почёта (ТЗ §4.5): уроки за период и словарный запас (не за период). */
export interface PeriodTotals {
  lessons: number;
  words: number;
}

/** Что о наградах знает progress: даты — сутки по Уфе. */
export interface AchievementFacts {
  /** Дни занятий (серия). */
  activeDays: string[];
  /** Уроки, засчитанные испытанием для перехода. */
  skips: { lessonId: string; on: string }[];
  /** Голоса «Помоги языку» по журналу мёда (judgmentId — голос). */
  votes: { judgmentId: string; on: string }[];
}

export interface ProgressApi {
  /** Мёд за урок, день серии, счётчики, прохождение урока; очки лиги и квест класса — через competition. */
  recordLessonCompletion(tx: Db, input: LessonCompletionInput): Promise<LessonCompletionResult>;
  /** «Мёд созревает»: pending 3 за голос (skip — ничего). Повтор с тем же judgmentId не удваивает. */
  creditVote(tx: Db, vote: VoteSettlement & { at: Date }): Promise<void>;
  /** Решение по исходнику: pending → final (3 при согласии, 1 при несогласии — voteHoney). */
  settleVotes(tx: Db, decision: DuelDecision, votes: readonly VoteSettlement[], at: Date): Promise<void>;
  /** Мёд «созревает» по голосам забега — для итога урока. */
  pendingHoney(accountId: string, judgmentIds: readonly string[], db?: Db): Promise<number>;
  /** Сколько раз аккаунт прошёл каждый узел тропы (для состояний узлов). */
  lessonCompletions(accountId: string): Promise<Map<string, number>>;
  /**
   * Уроки, засчитанные сданным испытанием для перехода (docs/02 §2): записать (только вставка; уже записанные и
   * пройденные — как есть) и прочитать. На тропе они пройдены; в счётчики, прогресс класса и задания учителя не идут.
   */
  recordSkips(tx: Db, input: { accountId: string; lessonIds: readonly string[]; runId: string; at: Date }): Promise<void>;
  lessonSkips(accountId: string): Promise<Set<string>>;
  /** Серия и цель дня на сутки `now` по Уфе — без начислений (итог несданного испытания). */
  dayState(db: Db, accountId: string, now: Date): Promise<{ streak: Schema<"StreakState">; dailyGoal: Schema<"DailyGoal"> }>;
  /** Первое прохождение узлов тропы аккаунтами: ключ «accountId:lessonId» → момент (для заданий учителя, ADR 0021). */
  firstPasses(accountIds: readonly string[], lessonIds: readonly string[]): Promise<Map<string, Date>>;
  /**
   * Чья серия под угрозой на сутки `now` по Уфе: серия есть (current > 0), но цель дня сегодня ещё не выполнена —
   * для напоминаний (модуль telegram, ADR 0020). Возвращает подмножество `accountIds`.
   */
  streaksAtRisk(accountIds: readonly string[], now: Date): Promise<Set<string>>;
  /** Кабинет министерства (ADR 0023): уроки всего и за неделю `week` и слова — по аккаунтам набора (у кого ничего нет — нет в Map). */
  learnerTotals(accountIds: readonly string[], week: { start: string; end: string }): Promise<Map<string, LearnerTotals>>;
  /** Кабинет министерства: уроки и занимавшиеся из набора по неделям (ключ — понедельник) в сутках `from`…`to`. */
  weeklyActivity(accountIds: readonly string[], from: string, to: string): Promise<Map<string, { lessons: number; active: number }>>;
  /** Публичная доска почёта (ТЗ §4.5): уроки за период от суток `from` и словарный запас — по аккаунтам набора. */
  periodTotals(accountIds: readonly string[], from: string): Promise<Map<string, PeriodTotals>>;
  /** История аккаунта для наград (learning, векторы contracts/test-vectors/achievements); `db` — транзакция вызывающего. */
  achievementFacts(db: Db, accountId: string): Promise<AchievementFacts>;

  // ── операции контракта ──
  myProgress(principal: Principal): Promise<Schema<"MyProgress">>;
  classProgress(principal: Principal, classId: string): Promise<Schema<"ClassProgress">>;
  /** Карточка ученика у учителя по номеру места (без ника и ПДн). */
  seatProgress(principal: Principal, classId: string, seatNumber: number): Promise<Schema<"SeatProgressCard">>;
}
