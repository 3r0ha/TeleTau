// Таблицы модуля competition (ADR 0014): недельная лига медоносов и активность класса для квеста. Правила лиги —
// @teletau/domain-rules (league.ts): неделя пн–вс по Уфе, первые 5 вверх, последние 3 вниз, закрытие — лениво.
// Ссылки на аккаунты и классы — простые uuid без внешних ключей; ПДн нет — ники берутся у identity по запросу.
import { sql } from "drizzle-orm";
import { check, date, index, integer, pgEnum, pgTable, primaryKey, smallint, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps, tstz } from "../../db/columns.js";

export const leagueTier = pgEnum("competition_league_tier", ["clover", "buckwheat", "sweetclover", "fireweed", "linden"]);
/**
 * Дети соревнуются только с детьми своей возрастной группы, взрослые — со взрослыми (docs/02 §6). 0010 (ADR 0022):
 * детские группы — по возрастному диапазону (7–10, 11–14, 15–17; у ученика класса — по номеру класса); `child` —
 * группы до 0010 и дети, у которых диапазон ещё неизвестен.
 */
export const ageGroup = pgEnum("competition_age_group", ["child", "adult", "child_7_10", "child_11_14", "child_15_17"]);
export const leagueOutcome = pgEnum("competition_league_outcome", ["promoted", "stayed", "demoted"]);

/** Группа лиги на неделю: до 20 участников одного тира и одной возрастной группы. */
export const leagueGroups = pgTable(
  "league_groups",
  {
    id: primaryId(),
    weekStart: date("week_start").notNull(),
    tier: leagueTier("tier").notNull(),
    ageGroup: ageGroup("age_group").notNull(),
    /** Неделя закрыта (итоги посчитаны) — лениво, при первом запросе следующей недели. */
    closedAt: tstz("closed_at"),
    ...timestamps(),
  },
  (t) => [index("league_groups_week_tier_idx").on(t.weekStart, t.tier, t.ageGroup)],
);

/** Участник группы: очки недели, итог и момент, когда итог просмотрен (экран «Новая лига»). */
export const leagueMembers = pgTable(
  "league_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => leagueGroups.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    weekStart: date("week_start").notNull(),
    points: integer("points").notNull().default(0),
    /** Когда набраны текущие очки: при равенстве выше тот, кто набрал раньше. */
    scoredAt: tstz("scored_at").notNull(),
    rank: smallint("rank"),
    outcome: leagueOutcome("outcome"),
    tierAfter: leagueTier("tier_after"),
    resultSeenAt: tstz("result_seen_at"),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: "league_members_pk", columns: [t.groupId, t.accountId] }),
    uniqueIndex("league_members_account_week_uq").on(t.accountId, t.weekStart),
    index("league_members_unseen_idx").on(t.accountId).where(sql`${t.outcome} IS NOT NULL AND ${t.resultSeenAt} IS NULL`),
    check("league_members_points_nonnegative", sql`${t.points} >= 0`),
    check("league_members_result_pair", sql`(${t.outcome} IS NULL) = (${t.tierAfter} IS NULL)`),
  ],
);

/** Активность класса по дням (для квеста и участия): только агрегаты наружу, без мест и ников. */
export const classWeekActivity = pgTable(
  "class_week_activity",
  {
    classId: uuid("class_id").notNull(),
    day: date("day").notNull(),
    weekStart: date("week_start").notNull(),
    accountId: uuid("account_id").notNull(),
    /** Пройдено уроков («запечатано сот») в этот день. */
    lessons: integer("lessons").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: "class_week_activity_pk", columns: [t.classId, t.day, t.accountId] }),
    index("class_week_activity_week_idx").on(t.classId, t.weekStart),
    check("class_week_activity_lessons_nonnegative", sql`${t.lessons} >= 0`),
  ],
);
