import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { dateToDay, dayToDate, ufaWeek } from "@teletau/domain-rules";
import { ACCOUNTS_PORT, type AccountsPort } from "../../common/ports.js";
import { notFound } from "../../common/problem.js";
import { ConsensusService } from "../consensus/index.js";
import { RosterService, type Roster, type RosterDistrict, type RosterSchool } from "../org/index.js";
import { ProgressService, type LearnerTotals } from "../progress/index.js";
import { groupCount, SMALL_GROUP_THRESHOLD, suppressOne, suppressRows, ZERO, type GroupCounts } from "./small-groups.js";

/** Недель в динамике (текущая — последняя). */
export const REPUBLIC_WEEKS = 8;

type Week = { start: string; end: string };

/** Срез на момент запроса: состав (org), «Учусь сам» (identity) и числа учеников (progress). */
interface Snapshot {
  now: Date;
  week: Week;
  roster: Roster;
  totals: Map<string, LearnerTotals>;
  /** Ученики «Учусь сам» без места в действующем классе (с местом — уже ученики школы). */
  selfIds: Set<string>;
  /** Группа «Учусь сам» не скрыта — входит в итоги республики. */
  selfVisible: boolean;
  teachersVerified: number;
}

/**
 * Кабинет министерства (ADR 0023): только агрегаты по республике, районам и школам. Своих таблиц у модуля нет —
 * числа собираются из публичных сервисов org (состав), identity (порт: «Учусь сам», учителя), progress (уроки, слова) и
 * consensus (голоса, принятые пары); чужие таблицы не читаются (ADR 0014). Идентификаторы аккаунтов живут только
 * внутри расчёта — в ответах одни числа, малые группы скрыты (small-groups.ts).
 * Масштаб: срез считается на каждый запрос в Postgres — для пилота (десятки тысяч учеников) этого хватает; витрина
 * в ClickHouse по доменным событиям — в роадмапе (docs/09-roadmap.md).
 */
@Injectable()
export class MinistryService {
  constructor(
    private readonly roster: RosterService,
    private readonly progress: ProgressService,
    private readonly consensus: ConsensusService,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
  ) {}

  async summary(now: Date = new Date()): Promise<Schema<"RepublicSummary">> {
    const s = await this.snapshot(now);
    const [stats, weeks] = await Promise.all([this.consensus.republicStats(), this.weeks(s, this.learners(s))]);
    const school = this.schoolStudents(s.roster.schools);
    const learners = this.learners(s);
    const counts = this.countsOf(s, learners);
    const activity = suppressOne(counts);
    const districts = this.listedDistricts(s.roster);
    const connected = new Set(s.roster.schools.map((x) => x.districtId));
    return {
      asOf: now.toISOString(),
      week: s.week,
      smallGroupThreshold: SMALL_GROUP_THRESHOLD,
      districts: { connected: districts.filter((d) => connected.has(d.id)).length, total: districts.length },
      schools: { connected: s.roster.schools.length, total: districts.reduce((n, d) => n + d.schoolsTotal, 0) },
      classes: s.roster.schools.reduce((n, x) => n + x.classes, 0),
      students: { school: groupCount(school.size), self: groupCount(s.selfIds.size) },
      teachersVerified: s.teachersVerified,
      learners: activity,
      ...(activity.suppression ? {} : { wordsLearned: [...learners].reduce((n, id) => n + (s.totals.get(id)?.wordsLearned ?? 0), 0) }),
      votes: stats.votes,
      pairsAccepted: stats.pairsAccepted,
      weeks: activity.suppression ? [] : weeks,
    };
  }

  async districts(now: Date = new Date()): Promise<Schema<"RepublicDistrictList">> {
    const s = await this.snapshot(now);
    const districts = this.listedDistricts(s.roster);
    const counts = districts.map((d) => this.countsOf(s, this.schoolStudents(s.roster.schools.filter((x) => x.districtId === d.id))));
    const shown = suppressRows(counts);
    return {
      asOf: now.toISOString(),
      week: s.week,
      smallGroupThreshold: SMALL_GROUP_THRESHOLD,
      items: districts.map((d, i) => this.districtRow(s, d, shown[i]!)),
      selfLearners: suppressOne(this.countsOf(s, s.selfIds)),
      total: suppressOne(this.countsOf(s, this.learners(s))),
    };
  }

  async district(districtId: string, now: Date = new Date()): Promise<Schema<"RepublicDistrictDetail">> {
    if (!(await this.roster.districtExists(districtId))) throw notFound();
    // Скрыт ли район, решает список районов целиком (дополнительное скрытие зависит от соседей) — тот же расчёт.
    const s = await this.snapshot(now);
    const districts = this.listedDistricts(s.roster);
    const index = districts.findIndex((d) => d.id === districtId);
    if (index < 0) throw notFound(); // демо-район без классов в список не входит
    const shown = suppressRows(districts.map((d) => this.countsOf(s, this.schoolStudents(s.roster.schools.filter((x) => x.districtId === d.id)))));
    const row = this.districtRow(s, districts[index]!, shown[index]!);
    const schools = s.roster.schools.filter((x) => x.districtId === districtId);
    if (row.activity.suppression) return { asOf: now.toISOString(), week: s.week, smallGroupThreshold: SMALL_GROUP_THRESHOLD, district: row, items: [], weeks: [] };
    const schoolShown = suppressRows(schools.map((x) => this.countsOf(s, new Set(x.studentIds))));
    return {
      asOf: now.toISOString(),
      week: s.week,
      smallGroupThreshold: SMALL_GROUP_THRESHOLD,
      district: row,
      items: schools.map((x, i) => ({ schoolId: x.id, shortNameRu: x.shortNameRu, ...(x.isDemo ? { isDemo: true } : {}), classes: x.classes, activity: schoolShown[i]! })),
      weeks: await this.weeks(s, this.schoolStudents(schools)),
    };
  }

  // ── расчёт ──

  private async snapshot(now: Date): Promise<Snapshot> {
    const week = ufaWeek(now);
    const [roster, people] = await Promise.all([this.roster.roster(), this.accounts.republicAccounts()]);
    const school = this.schoolStudents(roster.schools);
    const selfIds = new Set(people.selfLearnerIds.filter((id) => !school.has(id)));
    const totals = await this.progress.learnerTotals([...school, ...selfIds], week);
    return {
      now,
      week: { start: week.start, end: week.end },
      roster,
      totals,
      selfIds,
      selfVisible: selfIds.size === 0 || selfIds.size >= SMALL_GROUP_THRESHOLD,
      teachersVerified: people.teachersVerified,
    };
  }

  /** Районы списка: все районы справочника, демо-район — только если в нём есть классы. */
  private listedDistricts(roster: Roster): RosterDistrict[] {
    const connected = new Set(roster.schools.map((x) => x.districtId));
    return roster.districts.filter((d) => !d.isDemo || connected.has(d.id));
  }

  private schoolStudents(schools: readonly RosterSchool[]): Set<string> {
    return new Set(schools.flatMap((x) => x.studentIds));
  }

  /** Ученики итогов республики: школьные и «Учусь сам», если эта группа не скрыта. */
  private learners(s: Snapshot): Set<string> {
    const all = this.schoolStudents(s.roster.schools);
    if (s.selfVisible) for (const id of s.selfIds) all.add(id);
    return all;
  }

  private countsOf(s: Snapshot, ids: ReadonlySet<string>): GroupCounts {
    const c = { ...ZERO, students: ids.size };
    for (const id of ids) {
      const t = s.totals.get(id);
      if (!t) continue;
      c.lessonsTotal += t.lessonsTotal;
      c.lessonsWeek += t.lessonsWeek;
      if (t.lessonsWeek > 0) c.activeWeek += 1;
    }
    return c;
  }

  private districtRow(s: Snapshot, d: RosterDistrict, activity: Schema<"LearnerActivity">): Schema<"RepublicDistrictRow"> {
    const schools = s.roster.schools.filter((x) => x.districtId === d.id);
    return {
      districtId: d.id,
      nameRu: d.nameRu,
      kind: d.kind,
      ...(d.isDemo ? { isDemo: true } : {}),
      schools: { connected: schools.length, total: d.schoolsTotal },
      classes: schools.reduce((n, x) => n + x.classes, 0),
      activity,
    };
  }

  /** Последние REPUBLIC_WEEKS недель набора — от старых к новым, недели без занятий — нулями. */
  private async weeks(s: Snapshot, ids: ReadonlySet<string>): Promise<Schema<"RepublicWeek">[]> {
    const lastMonday = dateToDay(s.week.start);
    const firstMonday = lastMonday - 7 * (REPUBLIC_WEEKS - 1);
    const byWeek = await this.progress.weeklyActivity([...ids], dayToDate(firstMonday), s.week.end);
    return Array.from({ length: REPUBLIC_WEEKS }, (_, i) => {
      const monday = firstMonday + 7 * i;
      const start = dayToDate(monday);
      const w = byWeek.get(start);
      return { week: { start, end: dayToDate(monday + 6) }, lessons: w?.lessons ?? 0, active: w?.active ?? 0 };
    });
  }
}
