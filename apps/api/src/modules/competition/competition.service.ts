import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { closeWeek, dateToDay, dayToDate, LEAGUE_GROUP_SIZE, LEAGUE_TIERS, leagueWeek, leagueZones, rankGroup, ufaDate, type LeagueTier } from "@teletau/domain-rules";
import { and, asc, desc, eq, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import type { Principal } from "../../common/auth.js";
import { ACCOUNTS_PORT, type AccountsPort } from "../../common/ports.js";
import { notFound } from "../../common/problem.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { ClassesService, ClassPolicy } from "../org/index.js";
import type { AgeGroup, CompetitionApi } from "./competition.api.js";
import { classWeekActivity, leagueGroups, leagueMembers } from "./competition.schema.js";
import { questGoal, questProgress } from "./quest.js";

const LOWEST_TIER: LeagueTier = LEAGUE_TIERS[0];

/** Группа лиги: взрослые — одна, дети — по возрастному диапазону (ADR 0022); `child` — диапазон неизвестен. */
type LeagueAgeGroup = (typeof leagueGroups.$inferSelect)["ageGroup"];
const CHILD_GROUP_BY_BAND: Partial<Record<Schema<"AgeBand">, LeagueAgeGroup>> = {
  age_7_10: "child_7_10",
  age_11_14: "child_11_14",
  age_15_17: "child_15_17",
};

/**
 * Лига медоносов и квест класса (таблицы competition.schema.ts, правила — @teletau/domain-rules league.ts).
 * Неделя пн–вс по Уфе; группа — до 20 участников одного тира и одной возрастной группы, назначается с первыми очками
 * недели. Неделя закрывается лениво: первый запрос участника в новой неделе считает итоги всей его прошлой группы.
 * Наружу — только ники из словаря и агрегаты класса (CLAUDE.md, правило 5). Методы принимают момент `now` —
 * так сид и тесты подменяют часы (docs/plans/M2.md, «Сборка»).
 */
@Injectable()
export class CompetitionService implements CompetitionApi {
  constructor(
    @Inject(DB) protected readonly db: Db,
    protected readonly classes: ClassPolicy,
    protected readonly classesService: ClassesService,
    @Inject(ACCOUNTS_PORT) protected readonly accounts: AccountsPort,
  ) {}

  // ── лига ──

  async addLeaguePoints(tx: Db, entry: { accountId: string; ageGroup: AgeGroup; points: number; at: Date }): Promise<void> {
    if (entry.points <= 0) return;
    const week = leagueWeek(entry.at).start;
    await this.closePastWeeks(tx, entry.accountId, week, entry.at);
    const updated = await tx
      .update(leagueMembers)
      .set({ points: sql`${leagueMembers.points} + ${entry.points}`, scoredAt: entry.at })
      .where(and(eq(leagueMembers.accountId, entry.accountId), eq(leagueMembers.weekStart, week)))
      .returning({ groupId: leagueMembers.groupId });
    if (updated.length > 0) return;

    const tier = await this.tierFor(tx, entry.accountId, week);
    const ageGroup = await this.leagueAgeGroup(tx, entry.accountId, entry.ageGroup);
    // Группы недели заполняются по очереди: блокировка на (неделя, тир, возрастная группа) — без гонки за 20-е место.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`teletau:league:${week}:${tier}:${ageGroup}`}, 0))`);
    const [open] = await tx
      .select({ id: leagueGroups.id, n: sql<number>`count(${leagueMembers.accountId})::int` })
      .from(leagueGroups)
      .leftJoin(leagueMembers, eq(leagueMembers.groupId, leagueGroups.id))
      .where(and(eq(leagueGroups.weekStart, week), eq(leagueGroups.tier, tier), eq(leagueGroups.ageGroup, ageGroup), isNull(leagueGroups.closedAt)))
      .groupBy(leagueGroups.id)
      .having(sql`count(${leagueMembers.accountId}) < ${LEAGUE_GROUP_SIZE}`)
      .orderBy(desc(sql`count(${leagueMembers.accountId})`), asc(leagueGroups.id))
      .limit(1);
    const groupId = open?.id ?? (await tx.insert(leagueGroups).values({ weekStart: week, tier, ageGroup }).returning({ id: leagueGroups.id }))[0]!.id;
    await tx.insert(leagueMembers).values({ groupId, accountId: entry.accountId, weekStart: week, points: entry.points, scoredAt: entry.at });
  }

  async unseenResult(accountId: string, now: Date = new Date(), db?: Db): Promise<Schema<"LeagueResult"> | undefined> {
    const run = async (tx: Db) => {
      await this.closePastWeeks(tx, accountId, leagueWeek(now).start, now);
      const [row] = await this.results(tx, accountId, and(isNull(leagueMembers.resultSeenAt)));
      return row;
    };
    return db ? run(db) : this.db.transaction(run);
  }

  async leagueBadge(accountId: string, now: Date = new Date()): Promise<Schema<"LeagueBadge"> | undefined> {
    return this.db.transaction(async (tx) => {
      const week = leagueWeek(now).start;
      await this.closePastWeeks(tx, accountId, week, now);
      const mine = await this.groupStanding(tx, accountId, week);
      if (mine) {
        const me = mine.ranked.find((r) => r.id === accountId)!;
        return { tier: mine.tier, points: me.points, rank: me.rank };
      }
      return { tier: await this.tierFor(tx, accountId, week), points: 0 };
    });
  }

  async currentLeague(principal: Principal, now: Date = new Date()): Promise<Schema<"LeagueStanding">> {
    const week = leagueWeek(now);
    const { tier, ranked, lastResult } = await this.db.transaction(async (tx) => {
      await this.closePastWeeks(tx, principal.accountId, week.start, now);
      const mine = await this.groupStanding(tx, principal.accountId, week.start);
      const previous = dayToDate(dateToDay(week.start) - 7);
      const [last] = await this.results(tx, principal.accountId, sql`(${leagueMembers.resultSeenAt} IS NULL OR ${leagueMembers.weekStart} = ${previous})`);
      return { tier: mine?.tier ?? (await this.tierFor(tx, principal.accountId, week.start)), ranked: mine?.ranked ?? [], lastResult: last };
    });
    const nicknames = ranked.length > 0 ? await this.accounts.nicknames(ranked.map((r) => r.id)) : new Map<string, string>();
    const members: Schema<"LeagueMember">[] = ranked.map((r) => {
      const nickname = nicknames.get(r.id);
      return { rank: r.rank, ...(nickname ? { nickname } : {}), points: r.points, me: r.id === principal.accountId, zone: r.zone };
    });
    const me = members.find((m) => m.me);
    return {
      week: { start: week.start, end: week.end },
      endsAt: week.endsAt.toISOString(),
      tier,
      zones: leagueZones(tier),
      members,
      ...(me ? { me } : {}),
      ...(lastResult ? { lastResult } : {}),
    };
  }

  async markResultSeen(principal: Principal, body: Schema<"LeagueResultSeenRequest">, now: Date = new Date()): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.closePastWeeks(tx, principal.accountId, leagueWeek(now).start, now);
      const [result] = await tx
        .select({ outcome: leagueMembers.outcome })
        .from(leagueMembers)
        .where(and(eq(leagueMembers.accountId, principal.accountId), eq(leagueMembers.weekStart, body.weekStart), isNotNull(leagueMembers.outcome)));
      if (!result) throw notFound();
      // Итоги более ранних недель тоже считаются просмотренными: экран «Новая лига» показывает только последний.
      await tx
        .update(leagueMembers)
        .set({ resultSeenAt: now })
        .where(
          and(
            eq(leagueMembers.accountId, principal.accountId),
            lte(leagueMembers.weekStart, body.weekStart),
            isNotNull(leagueMembers.outcome),
            isNull(leagueMembers.resultSeenAt),
          ),
        );
    });
  }

  // ── квест класса ──

  async recordClassActivity(tx: Db, entry: { classId: string; accountId: string; at: Date }): Promise<void> {
    const day = ufaDate(entry.at);
    await tx
      .insert(classWeekActivity)
      .values({ classId: entry.classId, day, weekStart: leagueWeek(entry.at).start, accountId: entry.accountId, lessons: 1 })
      .onConflictDoUpdate({
        target: [classWeekActivity.classId, classWeekActivity.day, classWeekActivity.accountId],
        set: { lessons: sql`${classWeekActivity.lessons} + 1`, updatedAt: entry.at },
      });
  }

  async classHive(principal: Principal, classId: string, now: Date = new Date()): Promise<Schema<"ClassHive">> {
    await this.classes.requireMember(principal, classId);
    const week = leagueWeek(now);
    const [rows, seats] = await Promise.all([
      this.db
        .select({ day: classWeekActivity.day, accountId: classWeekActivity.accountId, lessons: classWeekActivity.lessons })
        .from(classWeekActivity)
        .where(and(eq(classWeekActivity.classId, classId), eq(classWeekActivity.weekStart, week.start))),
      this.classesService.seatViews(classId),
    ]);
    // «Занимались N из M» — так же, как у учителя (ProgressService.classProgress): M — ученики с аккаунтом на месте,
    // N — те из них, кто занимался на неделе. Уроки ушедших из класса остаются в квесте, но не в «занимались».
    const seated = new Set(seats.flatMap((s) => (s.student ? [s.student.accountId] : [])));
    const students = seated.size;
    const perStudent = new Map<string, number>();
    const perDay = new Map<string, Set<string>>();
    for (const r of rows) {
      perStudent.set(r.accountId, (perStudent.get(r.accountId) ?? 0) + r.lessons);
      if (r.lessons > 0 && seated.has(r.accountId)) perDay.set(r.day, (perDay.get(r.day) ?? new Set()).add(r.accountId));
    }
    const goal = questGoal(students);
    const progress = questProgress([...perStudent.values()]);
    const active = [...perStudent].filter(([accountId, lessons]) => lessons > 0 && seated.has(accountId)).length;
    const monday = dateToDay(week.start);
    return {
      classId,
      week: { start: week.start, end: week.end },
      quest: { titleRu: questTitle(goal), goal, progress, completed: progress >= goal },
      participation: { active, total: students },
      days: Array.from({ length: 7 }, (_, i) => {
        const date = dayToDate(monday + i);
        return { date, active: perDay.get(date)?.size ?? 0 };
      }),
    };
  }

  // ── внутреннее ──

  /**
   * Группа лиги участника (ADR 0022): дети и взрослые не смешиваются никогда (`ageGroup` вызывающего — по виду
   * аккаунта), а дети соревнуются с ровесниками — по возрастному диапазону аккаунта из identity (самостоятельный
   * ученик указал его сам, у ученика класса он следует из номера класса). Группа назначается с первыми очками недели,
   * поэтому смена диапазона действует со следующей недели.
   */
  private async leagueAgeGroup(tx: Db, accountId: string, ageGroup: AgeGroup): Promise<LeagueAgeGroup> {
    if (ageGroup === "adult") return "adult";
    const band = await this.accounts.ageBand(tx, accountId);
    return (band && CHILD_GROUP_BY_BAND[band]) ?? "child";
  }

  /** Итоги недель участника, новые сначала (по условию `where`). */
  private async results(db: Db, accountId: string, where: ReturnType<typeof and>): Promise<Schema<"LeagueResult">[]> {
    const rows = await db
      .select({ weekStart: leagueMembers.weekStart, tier: leagueGroups.tier, member: leagueMembers })
      .from(leagueMembers)
      .innerJoin(leagueGroups, eq(leagueGroups.id, leagueMembers.groupId))
      .where(and(eq(leagueMembers.accountId, accountId), isNotNull(leagueMembers.outcome), where))
      .orderBy(desc(leagueMembers.weekStart))
      .limit(1);
    return rows.map((r) => ({
      weekStart: r.weekStart,
      tierBefore: r.tier,
      tierAfter: r.member.tierAfter!,
      outcome: r.member.outcome!,
      rank: r.member.rank!,
      points: r.member.points,
    }));
  }

  /** Группа участника на неделе `week` с местами и зонами (нет — участник ещё без очков на этой неделе). */
  private async groupStanding(db: Db, accountId: string, week: string) {
    const [mine] = await db
      .select({ groupId: leagueMembers.groupId, tier: leagueGroups.tier })
      .from(leagueMembers)
      .innerJoin(leagueGroups, eq(leagueGroups.id, leagueMembers.groupId))
      .where(and(eq(leagueMembers.accountId, accountId), eq(leagueMembers.weekStart, week)));
    if (!mine) return undefined;
    const members = await db
      .select({ id: leagueMembers.accountId, points: leagueMembers.points, scoredAt: leagueMembers.scoredAt })
      .from(leagueMembers)
      .where(eq(leagueMembers.groupId, mine.groupId));
    return { tier: mine.tier, ranked: rankGroup(mine.tier, members.map((m) => ({ id: m.id, points: m.points, scoredAt: m.scoredAt.toISOString() }))) };
  }

  /** Тир участника на неделе `week`: по итогу последней прошлой недели; без истории — низший. */
  private async tierFor(db: Db, accountId: string, week: string): Promise<LeagueTier> {
    const [last] = await db
      .select({ tier: leagueGroups.tier, tierAfter: leagueMembers.tierAfter })
      .from(leagueMembers)
      .innerJoin(leagueGroups, eq(leagueGroups.id, leagueMembers.groupId))
      .where(and(eq(leagueMembers.accountId, accountId), lt(leagueMembers.weekStart, week)))
      .orderBy(desc(leagueMembers.weekStart))
      .limit(1);
    return last ? (last.tierAfter ?? last.tier) : LOWEST_TIER;
  }

  /** Ленивое закрытие: незакрытые группы прошлых недель, где участвовал аккаунт, получают итоги (места, зоны, тир). */
  private async closePastWeeks(db: Db, accountId: string, week: string, now: Date): Promise<void> {
    const open = await db
      .select({ groupId: leagueGroups.id })
      .from(leagueMembers)
      .innerJoin(leagueGroups, eq(leagueGroups.id, leagueMembers.groupId))
      .where(and(eq(leagueMembers.accountId, accountId), lt(leagueMembers.weekStart, week), isNull(leagueGroups.closedAt)));
    for (const { groupId } of open) await this.closeGroup(db, groupId, now);
  }

  private async closeGroup(db: Db, groupId: string, now: Date): Promise<void> {
    const [group] = await db.select().from(leagueGroups).where(eq(leagueGroups.id, groupId)).for("update");
    if (!group || group.closedAt) return;
    const members = await db
      .select({ id: leagueMembers.accountId, points: leagueMembers.points, scoredAt: leagueMembers.scoredAt })
      .from(leagueMembers)
      .where(eq(leagueMembers.groupId, groupId));
    const results = closeWeek(group.tier, members.map((m) => ({ id: m.id, points: m.points, scoredAt: m.scoredAt.toISOString() })));
    for (const r of results) {
      await db
        .update(leagueMembers)
        .set({ rank: r.rank, outcome: r.outcome, tierAfter: r.tierAfter })
        .where(and(eq(leagueMembers.groupId, groupId), eq(leagueMembers.accountId, r.id)));
    }
    await db.update(leagueGroups).set({ closedAt: now }).where(eq(leagueGroups.id, groupId));
  }
}

/** Текст квеста недели (уроки всех учеников класса за неделю); клиенты показывают его как есть. */
export function questTitle(goal: number): string {
  const n = Math.abs(goal) % 100;
  const d = n % 10;
  const word = n > 10 && n < 20 ? "уроков" : d === 1 ? "урок" : d >= 2 && d <= 4 ? "урока" : "уроков";
  return `Пройдите всем классом ${goal} ${word}`;
}
