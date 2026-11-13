import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { computeStreakFromDays, dailyGoal, dateToDay, dayToDate, type DuelDecision, lessonHoney, ufaDate, ufaWeek, voteHoney, type StreakResult } from "@teletau/domain-rules";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Principal } from "../../common/auth.js";
import { ACCOUNTS_PORT, type AccountsPort } from "../../common/ports.js";
import { notFound } from "../../common/problem.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { CompetitionService } from "../competition/index.js";
import { ContentService } from "../content/index.js";
import { ClassesService, ClassPolicy } from "../org/index.js";
import type { AchievementFacts, LearnerTotals, LessonCompletionInput, LessonCompletionResult, PeriodTotals, ProgressApi, VoteSettlement } from "./progress.api.js";
import { activityDays, lessonProgress, lessonSkips, progressCounters, streaks, xpLedger } from "./progress.schema.js";

type CounterDelta = Partial<Record<"lessonsCompleted" | "wordsLearned" | "votesTotal" | "votesMatured", number>>;

/** Серия domain-rules → схема контракта StreakState (даты недели пн–вс). */
export function streakState(s: StreakResult): Schema<"StreakState"> {
  const monday = dateToDay(s.weekStart);
  return {
    current: s.current,
    longest: s.longest,
    freezes: s.freezes,
    extendedToday: s.extendedToday,
    today: s.today,
    week: s.week.map((status, i) => ({ date: dayToDate(monday + i), status })),
  };
}

/**
 * Мёд, серия, счётчики (таблицы progress.schema.ts). Числа — @teletau/domain-rules (векторы contracts/test-vectors/{xp,streak}).
 * Серия пересчитывается из activity_days (streaks — её кеш). Прогресс класса — по номерам мест, без ников и ПДн
 * (ники учитель берёт из GET /classes/{id}, ADR 0009); политика class-teacher: чужой класс — 403, нет класса — 404.
 */
@Injectable()
export class ProgressService implements ProgressApi {
  constructor(
    @Inject(DB) protected readonly db: Db,
    protected readonly competition: CompetitionService,
    protected readonly classes: ClassPolicy,
    protected readonly classesService: ClassesService,
    protected readonly content: ContentService,
    /** Цель дня, выбранная учеником (identity, ADR 0022), — через порт: таблицы identity модуль не читает. */
    @Inject(ACCOUNTS_PORT) protected readonly accounts: AccountsPort,
  ) {}

  // ── завершение урока ──

  async recordLessonCompletion(tx: Db, input: LessonCompletionInput): Promise<LessonCompletionResult> {
    const at = input.completedAt;
    const today = ufaDate(at);
    // Повторение слов — мёд как за урок (лимит повтора — по lessonId «review» за сутки); испытание для перехода — как
    // за «Испытание места».
    const kind = input.kind === "review" ? "lesson" : input.kind === "jump" ? "place_test" : input.kind;
    const honey = lessonHoney({ kind, firstAttempts: input.firstAttempts, completionToday: input.completionToday });
    /** Сота цели дня: урок, «Испытание места», повторение («Помоги языку» — нет). */
    const goalStep = input.kind === "help_language" ? 0 : 1;
    let goalBefore = 0;

    const ledger = await tx
      .insert(xpLedger)
      .values({ accountId: input.accountId, amount: honey.total, reason: "lesson", refId: input.runId, status: "final", earnedOn: today, finalizedAt: at })
      .onConflictDoNothing({ target: [xpLedger.accountId, xpLedger.reason, xpLedger.refId] })
      .returning({ id: xpLedger.id });
    const fresh = ledger.length > 0;

    if (fresh) {
      const [day] = await tx
        .select({ goalLessons: activityDays.goalLessons })
        .from(activityDays)
        .where(and(eq(activityDays.accountId, input.accountId), eq(activityDays.day, today)))
        .for("update");
      goalBefore = day?.goalLessons ?? 0;
      await tx
        .insert(activityDays)
        .values({ accountId: input.accountId, day: today, lessons: 1, goalLessons: goalStep, honey: honey.total, firstAt: at })
        .onConflictDoUpdate({
          target: [activityDays.accountId, activityDays.day],
          set: {
            lessons: sql`${activityDays.lessons} + 1`,
            goalLessons: sql`${activityDays.goalLessons} + ${goalStep}`,
            honey: sql`${activityDays.honey} + ${honey.total}`,
            updatedAt: at,
          },
        });
    }
    // Прохождение узла — у узлов тропы; уроки, открытые испытанием для перехода, пишет recordSkips.
    if (fresh && input.kind !== "review" && input.kind !== "jump") {
      const [before] = await tx
        .select({ completions: lessonProgress.completions })
        .from(lessonProgress)
        .where(and(eq(lessonProgress.accountId, input.accountId), eq(lessonProgress.lessonId, input.lessonId)));
      await tx
        .insert(lessonProgress)
        .values({ accountId: input.accountId, lessonId: input.lessonId, completions: 1, bestAccuracy: input.accuracy, firstCompletedAt: at, lastCompletedAt: at })
        .onConflictDoUpdate({
          target: [lessonProgress.accountId, lessonProgress.lessonId],
          set: {
            completions: sql`${lessonProgress.completions} + 1`,
            bestAccuracy: sql`greatest(coalesce(${lessonProgress.bestAccuracy}, 0), ${input.accuracy})`,
            lastCompletedAt: at,
            updatedAt: at,
          },
        });
      const firstTime = !before && input.kind !== "help_language";
      if (firstTime) await this.bumpCounters(tx, input.accountId, { lessonsCompleted: 1, wordsLearned: input.newWords });
    }
    if (fresh) {
      const ageGroup = input.accountKind === "child" ? "child" : "adult";
      await this.competition.addLeaguePoints(tx, { accountId: input.accountId, ageGroup, points: honey.total, at });
      if (input.accountKind === "child") {
        const mine = await this.classesService.myClasses({ accountId: input.accountId, roles: ["student"] });
        for (const c of mine) if (c.role === "student") await this.competition.recordClassActivity(tx, { classId: c.id, accountId: input.accountId, at });
      }
    }

    const streak = await this.streakOf(tx, input.accountId, today);
    await tx
      .insert(streaks)
      .values({ accountId: input.accountId, current: streak.current, longest: streak.longest, freezes: streak.freezes, lastDay: today })
      .onConflictDoUpdate({
        target: streaks.accountId,
        set: { current: streak.current, longest: streak.longest, freezes: streak.freezes, lastDay: today, updatedAt: at },
      });
    const leagueResult = await this.competition.unseenResult(input.accountId, at, tx);
    const goal = await this.goalOf(tx, input.accountId, today);
    const dailyGoalReached = fresh && goalStep > 0 && goalBefore < goal.target && goal.met;
    return { honey, completionToday: input.completionToday, streak: streakState(streak), ...(leagueResult ? { leagueResult } : {}), dailyGoal: goal, dailyGoalReached };
  }

  async lessonCompletions(accountId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ lessonId: lessonProgress.lessonId, completions: lessonProgress.completions })
      .from(lessonProgress)
      .where(eq(lessonProgress.accountId, accountId));
    return new Map(rows.map((r) => [r.lessonId, r.completions]));
  }

  async recordSkips(tx: Db, input: { accountId: string; lessonIds: readonly string[]; runId: string; at: Date }): Promise<void> {
    if (input.lessonIds.length === 0) return;
    await tx
      .insert(lessonSkips)
      .values(input.lessonIds.map((lessonId) => ({ accountId: input.accountId, lessonId, runId: input.runId, createdAt: input.at })))
      .onConflictDoNothing({ target: [lessonSkips.accountId, lessonSkips.lessonId] });
  }

  async lessonSkips(accountId: string): Promise<Set<string>> {
    const rows = await this.db.select({ lessonId: lessonSkips.lessonId }).from(lessonSkips).where(eq(lessonSkips.accountId, accountId));
    return new Set(rows.map((r) => r.lessonId));
  }

  async dayState(db: Db, accountId: string, now: Date): Promise<{ streak: Schema<"StreakState">; dailyGoal: Schema<"DailyGoal"> }> {
    const today = ufaDate(now);
    const [streak, dailyGoal] = await Promise.all([this.streakOf(db, accountId, today), this.goalOf(db, accountId, today)]);
    return { streak: streakState(streak), dailyGoal };
  }

  async firstPasses(accountIds: readonly string[], lessonIds: readonly string[]): Promise<Map<string, Date>> {
    if (accountIds.length === 0 || lessonIds.length === 0) return new Map();
    const rows = await this.db
      .select({ accountId: lessonProgress.accountId, lessonId: lessonProgress.lessonId, at: lessonProgress.firstCompletedAt })
      .from(lessonProgress)
      .where(and(inArray(lessonProgress.accountId, [...accountIds]), inArray(lessonProgress.lessonId, [...lessonIds])));
    return new Map(rows.map((r) => [`${r.accountId}:${r.lessonId}`, r.at]));
  }

  // ── агрегаты для кабинета министерства (ADR 0023): по наборам аккаунтов, наружу модуля — только числа ──

  async learnerTotals(accountIds: readonly string[], week: { start: string; end: string }): Promise<Map<string, LearnerTotals>> {
    const out = new Map<string, LearnerTotals>();
    if (accountIds.length === 0) return out;
    const ids = sql.param([...accountIds]);
    const [days, counters] = await Promise.all([
      this.db
        .select({
          accountId: activityDays.accountId,
          total: sql<number>`coalesce(sum(${activityDays.lessons}), 0)::int`,
          week: sql<number>`coalesce(sum(${activityDays.lessons}) FILTER (WHERE ${activityDays.day} BETWEEN ${week.start} AND ${week.end}), 0)::int`,
        })
        .from(activityDays)
        .where(sql`${activityDays.accountId} = ANY(${ids}::uuid[])`)
        .groupBy(activityDays.accountId),
      this.db
        .select({ accountId: progressCounters.accountId, words: progressCounters.wordsLearned })
        .from(progressCounters)
        .where(sql`${progressCounters.accountId} = ANY(${ids}::uuid[])`),
    ]);
    const of = (id: string) => out.get(id) ?? out.set(id, { lessonsTotal: 0, lessonsWeek: 0, wordsLearned: 0 }).get(id)!;
    for (const d of days) Object.assign(of(d.accountId), { lessonsTotal: d.total, lessonsWeek: d.week });
    for (const c of counters) of(c.accountId).wordsLearned = c.words;
    return out;
  }

  async weeklyActivity(accountIds: readonly string[], from: string, to: string): Promise<Map<string, { lessons: number; active: number }>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        weekStart: sql<string>`to_char(date_trunc('week', ${activityDays.day})::date, 'YYYY-MM-DD')`,
        lessons: sql<number>`coalesce(sum(${activityDays.lessons}), 0)::int`,
        active: sql<number>`count(DISTINCT ${activityDays.accountId}) FILTER (WHERE ${activityDays.lessons} > 0)::int`,
      })
      .from(activityDays)
      .where(and(sql`${activityDays.accountId} = ANY(${sql.param([...accountIds])}::uuid[])`, gte(activityDays.day, from), lte(activityDays.day, to)))
      .groupBy(sql`1`);
    return new Map(rows.map((r) => [r.weekStart, { lessons: r.lessons, active: r.active }]));
  }

  /** Публичная доска почёта (ТЗ §4.5): уроки за период (activity_days от суток `from`) и словарный запас — счётчик слов всего. */
  async periodTotals(accountIds: readonly string[], from: string): Promise<Map<string, PeriodTotals>> {
    const out = new Map<string, PeriodTotals>();
    if (accountIds.length === 0) return out;
    const ids = sql.param([...accountIds]);
    const [days, counters] = await Promise.all([
      this.db
        .select({ accountId: activityDays.accountId, lessons: sql<number>`coalesce(sum(${activityDays.lessons}), 0)::int` })
        .from(activityDays)
        .where(and(sql`${activityDays.accountId} = ANY(${ids}::uuid[])`, gte(activityDays.day, from)))
        .groupBy(activityDays.accountId),
      this.db
        .select({ accountId: progressCounters.accountId, words: progressCounters.wordsLearned })
        .from(progressCounters)
        .where(sql`${progressCounters.accountId} = ANY(${ids}::uuid[])`),
    ]);
    const of = (id: string) => out.get(id) ?? out.set(id, { lessons: 0, words: 0 }).get(id)!;
    for (const d of days) of(d.accountId).lessons = d.lessons;
    for (const c of counters) of(c.accountId).words = c.words;
    return out;
  }

  async achievementFacts(db: Db, accountId: string): Promise<AchievementFacts> {
    // По очереди: db бывает транзакцией (одно соединение).
    const days = await db
      .select({ day: activityDays.day })
      .from(activityDays)
      .where(and(eq(activityDays.accountId, accountId), sql`${activityDays.lessons} > 0`));
    const skips = await db.select({ lessonId: lessonSkips.lessonId, at: lessonSkips.createdAt }).from(lessonSkips).where(eq(lessonSkips.accountId, accountId));
    // Все голоса журнала мёда (и созревающие, и решённые) — то же число, что votes.total в GET /me/progress.
    const votes = await db
      .select({ judgmentId: xpLedger.refId, on: xpLedger.earnedOn })
      .from(xpLedger)
      .where(and(eq(xpLedger.accountId, accountId), eq(xpLedger.reason, "vote")));
    return {
      activeDays: days.map((d) => d.day),
      skips: skips.map((s) => ({ lessonId: s.lessonId, on: ufaDate(s.at) })),
      votes,
    };
  }

  // ── мёд за голос: «мёд созревает» (pending) → решение (final) ──

  async streaksAtRisk(accountIds: readonly string[], now: Date): Promise<Set<string>> {
    const at = new Set<string>();
    if (accountIds.length === 0) return at;
    const today = ufaDate(now);
    const rows = await this.db
      .select({ accountId: activityDays.accountId, day: activityDays.day })
      .from(activityDays)
      .where(and(inArray(activityDays.accountId, [...accountIds]), sql`${activityDays.lessons} > 0`, lte(activityDays.day, today)));
    const daysOf = new Map<string, string[]>();
    for (const r of rows) daysOf.set(r.accountId, [...(daysOf.get(r.accountId) ?? []), r.day]);
    for (const [accountId, days] of daysOf) {
      const s = computeStreakFromDays({ days, today });
      if (s.current > 0 && !s.extendedToday) at.add(accountId);
    }
    return at;
  }

  async creditVote(tx: Db, vote: VoteSettlement & { at: Date }): Promise<void> {
    const honey = voteHoney({ choice: vote.choice, decision: null });
    if (honey.status === "none") return;
    const inserted = await tx
      .insert(xpLedger)
      .values({ accountId: vote.accountId, amount: honey.amount, reason: "vote", refId: vote.judgmentId, status: "pending", earnedOn: ufaDate(vote.at) })
      .onConflictDoNothing({ target: [xpLedger.accountId, xpLedger.reason, xpLedger.refId] })
      .returning({ id: xpLedger.id });
    if (inserted.length > 0) await this.bumpCounters(tx, vote.accountId, { votesTotal: 1 });
  }

  async settleVotes(tx: Db, decision: DuelDecision, votes: readonly VoteSettlement[], at: Date): Promise<void> {
    for (const vote of votes) {
      const honey = voteHoney({ choice: vote.choice, decision });
      if (honey.status !== "final") continue;
      const where = and(eq(xpLedger.accountId, vote.accountId), eq(xpLedger.reason, "vote"), eq(xpLedger.refId, vote.judgmentId));
      const updated = await tx
        .update(xpLedger)
        .set({ amount: honey.amount, status: "final", finalizedAt: at })
        .where(and(where, eq(xpLedger.status, "pending")))
        .returning({ id: xpLedger.id });
      if (updated.length > 0) {
        await this.bumpCounters(tx, vote.accountId, { votesMatured: 1 });
        continue;
      }
      // Голос без записи «созревает» (creditVote не вызывался) — сразу начисленный мёд; есть final/revoked — не трогаем.
      const inserted = await tx
        .insert(xpLedger)
        .values({ accountId: vote.accountId, amount: honey.amount, reason: "vote", refId: vote.judgmentId, status: "final", earnedOn: ufaDate(at), finalizedAt: at })
        .onConflictDoNothing({ target: [xpLedger.accountId, xpLedger.reason, xpLedger.refId] })
        .returning({ id: xpLedger.id });
      if (inserted.length > 0) await this.bumpCounters(tx, vote.accountId, { votesTotal: 1, votesMatured: 1 });
    }
  }

  async pendingHoney(accountId: string, judgmentIds: readonly string[], db: Db = this.db): Promise<number> {
    if (judgmentIds.length === 0) return 0;
    const [row] = await db
      .select({ sum: sql<number>`coalesce(sum(${xpLedger.amount}), 0)::int` })
      .from(xpLedger)
      .where(and(eq(xpLedger.accountId, accountId), eq(xpLedger.reason, "vote"), eq(xpLedger.status, "pending"), inArray(xpLedger.refId, [...judgmentIds])));
    return row?.sum ?? 0;
  }

  // ── операции контракта ──

  async myProgress(principal: Principal, now: Date = new Date()): Promise<Schema<"MyProgress">> {
    const id = principal.accountId;
    const [honey, counters, streak, league, goal] = await Promise.all([
      this.db
        .select({
          final: sql<number>`coalesce(sum(${xpLedger.amount}) FILTER (WHERE ${xpLedger.status} = 'final'), 0)::int`,
          pending: sql<number>`coalesce(sum(${xpLedger.amount}) FILTER (WHERE ${xpLedger.status} = 'pending'), 0)::int`,
        })
        .from(xpLedger)
        .where(eq(xpLedger.accountId, id)),
      this.db.select().from(progressCounters).where(eq(progressCounters.accountId, id)),
      this.streakOf(this.db, id, ufaDate(now)),
      this.competition.leagueBadge(id, now),
      this.goalOf(this.db, id, ufaDate(now)),
    ]);
    const c = counters[0];
    const votesTotal = c?.votesTotal ?? 0;
    const matured = c?.votesMatured ?? 0;
    return {
      honey: { total: honey[0]?.final ?? 0, pending: honey[0]?.pending ?? 0 },
      streak: streakState(streak),
      dailyGoal: goal,
      ...(league ? { league } : {}),
      lessonsCompleted: c?.lessonsCompleted ?? 0,
      wordsLearned: c?.wordsLearned ?? 0,
      votes: { total: votesTotal, matured, pending: Math.max(0, votesTotal - matured) },
    };
  }

  async classProgress(principal: Principal, classId: string, now: Date = new Date()): Promise<Schema<"ClassProgress">> {
    await this.classes.requireTeacher(principal, classId);
    const week = ufaWeek(now);
    const today = ufaDate(now);
    const seats = await this.classesService.seatViews(classId);
    const occupied = seats.flatMap((s) => (s.student ? [{ number: s.number, accountId: s.student.accountId }] : []));
    const ids = occupied.map((s) => s.accountId);

    const course = await this.content.course().catch(() => undefined);
    const openUnits = (course?.units ?? []).filter((u) => u.status === "open");
    const trailLessons = openUnits.flatMap((u) => u.nodes.filter((n) => n.kind !== "help_language"));

    const [days, ledger, counters, lessons] =
      ids.length === 0
        ? [[], [], [], []]
        : await Promise.all([
            this.db.select().from(activityDays).where(inArray(activityDays.accountId, ids)),
            this.db
              .select({
                accountId: xpLedger.accountId,
                honey: sql<number>`coalesce(sum(${xpLedger.amount}) FILTER (WHERE ${xpLedger.status} = 'final'), 0)::int`,
                votes: sql<number>`count(*) FILTER (WHERE ${xpLedger.reason} = 'vote')::int`,
              })
              .from(xpLedger)
              .where(and(inArray(xpLedger.accountId, ids), gte(xpLedger.earnedOn, week.start), lte(xpLedger.earnedOn, week.end)))
              .groupBy(xpLedger.accountId),
            this.db.select().from(progressCounters).where(inArray(progressCounters.accountId, ids)),
            this.db
              .select({ accountId: lessonProgress.accountId, lessonId: lessonProgress.lessonId, bestAccuracy: lessonProgress.bestAccuracy })
              .from(lessonProgress)
              .where(inArray(lessonProgress.accountId, ids)),
          ]);

    const daysOf = new Map<string, (typeof days)[number][]>();
    for (const d of days) daysOf.set(d.accountId, [...(daysOf.get(d.accountId) ?? []), d]);
    const ledgerOf = new Map(ledger.map((l) => [l.accountId, l]));
    const countersOf = new Map(counters.map((c) => [c.accountId, c]));
    const accuracyOf = new Map<string, number[]>();
    const completedSeats = new Map<string, number>();
    for (const l of lessons) {
      completedSeats.set(l.lessonId, (completedSeats.get(l.lessonId) ?? 0) + 1);
      if (l.bestAccuracy !== null) accuracyOf.set(l.accountId, [...(accuracyOf.get(l.accountId) ?? []), l.bestAccuracy]);
    }

    let activeSeats = 0;
    let lessonsWeek = 0;
    let honeyWeek = 0;
    let votesWeek = 0;
    const seatRows: Schema<"SeatProgress">[] = occupied.map((s) => {
      const mine = daysOf.get(s.accountId) ?? [];
      const inWeek = mine.filter((d) => d.day >= week.start && d.day <= week.end);
      const lessonsThisWeek = inWeek.reduce((n, d) => n + d.lessons, 0);
      const l = ledgerOf.get(s.accountId);
      const acc = accuracyOf.get(s.accountId);
      const last = mine.reduce<string | undefined>((m, d) => (m === undefined || d.day > m ? d.day : m), undefined);
      if (inWeek.length > 0) activeSeats++;
      lessonsWeek += lessonsThisWeek;
      honeyWeek += l?.honey ?? 0;
      votesWeek += l?.votes ?? 0;
      return {
        seatNumber: s.number,
        lessonsCompleted: countersOf.get(s.accountId)?.lessonsCompleted ?? 0,
        wordsLearned: countersOf.get(s.accountId)?.wordsLearned ?? 0,
        lessonsThisWeek,
        honeyThisWeek: l?.honey ?? 0,
        streak: computeStreakFromDays({ days: mine.map((d) => d.day), today }).current,
        ...(last ? { lastActiveOn: last } : {}),
        ...(acc && acc.length > 0 ? { accuracy: Math.round((acc.reduce((a, b) => a + b, 0) / acc.length) * 100) / 100 } : {}),
      };
    });

    return {
      classId,
      week: { start: week.start, end: week.end },
      // «Занимались N из M»: M — ученики с аккаунтом на месте (как participation.total улья класса), а не все места.
      summary: { seatsTotal: seats.length, studentsTotal: occupied.length, activeSeats, lessonsCompleted: lessonsWeek, honeyEarned: honeyWeek, votes: votesWeek },
      seats: seatRows,
      // Уроки по местам тропы: учитель видит группы «Өфө», «Шүлгәнташ»… с общим процентом (units — заголовки групп).
      lessons: trailLessons.map((n) => ({ lessonId: n.id, titleRu: n.titleRu, completedSeats: completedSeats.get(n.id) ?? 0, unitId: n.unitId, kind: n.kind })),
      units: openUnits.map((u) => ({ id: u.id, order: u.position, place: u.place, topicRu: u.topicRu })),
    };
  }

  async seatProgress(principal: Principal, classId: string, seatNumber: number, now: Date = new Date()): Promise<Schema<"SeatProgressCard">> {
    await this.classes.requireTeacher(principal, classId);
    const seat = (await this.classesService.seatViews(classId)).find((s) => s.number === seatNumber);
    if (!seat?.student) throw notFound();
    const id = seat.student.accountId;
    const [days, counters, honey, lessons, course] = await Promise.all([
      this.db.select().from(activityDays).where(eq(activityDays.accountId, id)).orderBy(desc(activityDays.day)),
      this.db.select().from(progressCounters).where(eq(progressCounters.accountId, id)),
      this.db
        .select({ final: sql<number>`coalesce(sum(${xpLedger.amount}) FILTER (WHERE ${xpLedger.status} = 'final'), 0)::int` })
        .from(xpLedger)
        .where(eq(xpLedger.accountId, id)),
      this.db.select().from(lessonProgress).where(eq(lessonProgress.accountId, id)),
      this.content.course().catch(() => undefined),
    ]);
    const active = days.filter((d) => d.lessons > 0);
    const streak = computeStreakFromDays({ days: active.map((d) => d.day), today: ufaDate(now) });
    const byLesson = new Map(lessons.map((l) => [l.lessonId, l]));
    // Пройденные уроки — в порядке тропы; «Помоги языку» — это голоса, они отдельно.
    const done: Schema<"SeatLessonDone">[] = (course?.units ?? []).flatMap((u) =>
      u.nodes.flatMap((n) => {
        const l = byLesson.get(n.id);
        if (!l || n.kind === "help_language") return [];
        return [
          {
            lessonId: n.id,
            kind: n.kind,
            titleRu: n.titleRu,
            placeRu: u.place.titleRu,
            completions: l.completions,
            ...(l.bestAccuracy !== null ? { bestAccuracy: Math.round(l.bestAccuracy * 100) / 100 } : {}),
            lastCompletedOn: ufaDate(l.lastCompletedAt),
          },
        ];
      }),
    );
    const acc = done.flatMap((l) => (l.bestAccuracy !== undefined ? [l.bestAccuracy] : []));
    const c = counters[0];
    return {
      classId,
      seatNumber,
      lessonsCompleted: c?.lessonsCompleted ?? 0,
      wordsLearned: c?.wordsLearned ?? 0,
      ...(acc.length ? { accuracy: Math.round((acc.reduce((a, b) => a + b, 0) / acc.length) * 100) / 100 } : {}),
      streak: { current: streak.current, longest: streak.longest },
      votes: { total: c?.votesTotal ?? 0, matured: c?.votesMatured ?? 0 },
      honey: honey[0]?.final ?? 0,
      ...(active[0] ? { lastActiveOn: active[0].day } : {}),
      lessons: done,
      recentDays: active.slice(0, 7).map((d) => ({ date: d.day, lessons: d.lessons, honey: d.honey })),
    };
  }

  // ── внутреннее ──

  /** Цель дня по сотам суток (activity_days.goal_lessons); размер цели — выбор ученика (1–3) или по умолчанию. */
  private async goalOf(db: Db, accountId: string, today: string): Promise<Schema<"DailyGoal">> {
    const [row] = await db
      .select({ goalLessons: activityDays.goalLessons })
      .from(activityDays)
      .where(and(eq(activityDays.accountId, accountId), eq(activityDays.day, today)));
    return dailyGoal(row?.goalLessons ?? 0, await this.accounts.dailyGoalTarget(db, accountId));
  }

  private async streakOf(db: Db, accountId: string, today: string): Promise<StreakResult> {
    const rows = await db
      .select({ day: activityDays.day })
      .from(activityDays)
      .where(and(eq(activityDays.accountId, accountId), sql`${activityDays.lessons} > 0`));
    return computeStreakFromDays({ days: rows.map((r) => r.day), today });
  }

  private async bumpCounters(tx: Db, accountId: string, d: CounterDelta): Promise<void> {
    const v = { lessonsCompleted: 0, wordsLearned: 0, votesTotal: 0, votesMatured: 0, ...d };
    // CHECK progress_counters_votes (matured ≤ total) Postgres проверяет и на предлагаемой строке INSERT — до ON CONFLICT.
    // Поэтому в новой строке total не меньше matured, а у существующей прибавляются настоящие дельты.
    await tx
      .insert(progressCounters)
      .values({ accountId, ...v, votesTotal: Math.max(v.votesTotal, v.votesMatured) })
      .onConflictDoUpdate({
        target: progressCounters.accountId,
        set: {
          lessonsCompleted: sql`${progressCounters.lessonsCompleted} + ${v.lessonsCompleted}`,
          wordsLearned: sql`${progressCounters.wordsLearned} + ${v.wordsLearned}`,
          votesTotal: sql`${progressCounters.votesTotal} + ${v.votesTotal}`,
          votesMatured: sql`${progressCounters.votesMatured} + ${v.votesMatured}`,
          updatedAt: new Date(),
        },
      });
  }
}
