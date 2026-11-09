// Публичный интерфейс модуля competition: лига медоносов и квест класса (граф: competition → org, identity).
// Вызовы — в транзакции вызывающего (как AuditService): очки лиги и активность класса пишутся вместе с завершением урока.
import type { Schema } from "@teletau/contracts";
import type { Principal } from "../../common/auth.js";
import type { Db } from "../../db/database.js";

/**
 * Дети соревнуются только с детьми (docs/02 §6): вызывающий передаёт вид участника, а детскую группу по возрастному
 * диапазону уточняет сама лига (ADR 0022).
 */
export type AgeGroup = "child" | "adult";

export interface CompetitionApi {
  /** Очки лиги за неделю момента `at` (по Уфе); группа назначается с первыми очками недели. */
  addLeaguePoints(tx: Db, entry: { accountId: string; ageGroup: AgeGroup; points: number; at: Date }): Promise<void>;
  /** Урок ученика класса — в квест и участие недели. */
  recordClassActivity(tx: Db, entry: { classId: string; accountId: string; at: Date }): Promise<void>;
  /** Непросмотренный итог прошлой недели (экран «Новая лига»); закрывает неделю лениво. */
  unseenResult(accountId: string, now?: Date, db?: Db): Promise<Schema<"LeagueResult"> | undefined>;
  /** Тир, очки и место недели — для GET /me/progress. */
  leagueBadge(accountId: string, now?: Date): Promise<Schema<"LeagueBadge"> | undefined>;

  // ── операции контракта ──
  // `now` — подменённые часы для сида и тестов; контроллер его не передаёт.
  currentLeague(principal: Principal, now?: Date): Promise<Schema<"LeagueStanding">>;
  markResultSeen(principal: Principal, body: Schema<"LeagueResultSeenRequest">, now?: Date): Promise<void>;
  classHive(principal: Principal, classId: string, now?: Date): Promise<Schema<"ClassHive">>;
}
