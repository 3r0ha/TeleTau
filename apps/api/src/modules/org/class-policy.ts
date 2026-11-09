// ABAC-политики модуля org (ADR 0017 §2): «учитель класса» и «участник класса».
// Контроллеры их не реализуют, только вызывают через сервисы. Чужой класс — 403, несуществующий — 404.
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Principal } from "../../common/auth.js";
import type { ClassAccessPort } from "../../common/ports.js";
import { forbidden, notFound } from "../../common/problem.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { classSeats, classes, memberships } from "./org.schema.js";

export type ClassRow = typeof classes.$inferSelect;

@Injectable()
export class ClassPolicy implements ClassAccessPort {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findClass(classId: string, db: Db = this.db): Promise<ClassRow | undefined> {
    const [row] = await db.select().from(classes).where(eq(classes.id, classId));
    return row;
  }

  /** Политика class-teacher: класс существует (иначе 404) и принципал — его учитель (иначе 403). */
  async requireTeacher(principal: Principal, classId: string, db: Db = this.db): Promise<ClassRow> {
    const row = await this.findClass(classId, db);
    if (!row) throw notFound();
    if (row.teacherAccountId !== principal.accountId || !principal.roles.includes("teacher")) throw forbidden();
    return row;
  }

  /** Политика class-member: учитель класса или ученик с местом в нём. */
  async requireMember(principal: Principal, classId: string): Promise<{ row: ClassRow; role: "teacher" | "student"; seatNumber?: number }> {
    const row = await this.findClass(classId);
    if (!row) throw notFound();
    if (row.teacherAccountId === principal.accountId && principal.roles.includes("teacher")) return { row, role: "teacher" };
    if (principal.roles.includes("student")) {
      const [seat] = await this.db
        .select({ number: classSeats.seatNumber })
        .from(memberships)
        .innerJoin(classSeats, eq(classSeats.id, memberships.seatId))
        .where(
          and(
            eq(memberships.classId, classId),
            eq(memberships.accountId, principal.accountId),
            eq(memberships.role, "student"),
            isNull(memberships.leftAt),
          ),
        );
      if (seat) return { row, role: "student", seatNumber: seat.number };
    }
    throw forbidden();
  }

  // ── ClassAccessPort (для модуля consent) ──

  async requireTeacherSeat(principal: Principal, classId: string, seatNumber: number): Promise<{ seatId: string; accountId?: string }> {
    await this.requireTeacher(principal, classId);
    const [seat] = await this.db
      .select({ id: classSeats.id, accountId: classSeats.accountId })
      .from(classSeats)
      .where(and(eq(classSeats.classId, classId), eq(classSeats.seatNumber, seatNumber)));
    if (!seat) throw notFound();
    return { seatId: seat.id, ...(seat.accountId ? { accountId: seat.accountId } : {}) };
  }

  async isClassTeacher(principal: Principal, classId: string): Promise<boolean> {
    const row = await this.findClass(classId);
    return Boolean(row && row.teacherAccountId === principal.accountId && principal.roles.includes("teacher"));
  }

  async seatInfo(seatId: string, db: Db = this.db): Promise<{ classId: string; seatNumber: number; accountId?: string } | undefined> {
    const [seat] = await db
      .select({ classId: classSeats.classId, seatNumber: classSeats.seatNumber, accountId: classSeats.accountId })
      .from(classSeats)
      .where(eq(classSeats.id, seatId));
    return seat ? { classId: seat.classId, seatNumber: seat.seatNumber, ...(seat.accountId ? { accountId: seat.accountId } : {}) } : undefined;
  }

  /**
   * Рекомендательная блокировка места до конца транзакции (ClassAccessPort.lockSeat). Не строка class_seats
   * FOR UPDATE: отзыв согласия (модуль consent) таблицы org не трогает, а ключ блокировки — общий через этот порт.
   */
  async lockSeat(db: Db, seatId: string): Promise<void> {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`teletau:seat-access:${seatId}`}, 0))`);
  }
}
