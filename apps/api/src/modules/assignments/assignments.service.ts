import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Principal } from "../../common/auth.js";
import { conflict, invalidField, notFound } from "../../common/problem.js";
import type { Db } from "../../db/database.js";
import { IdempotencyStore, requestFingerprint } from "../../infra/idempotency.js";
import { DB } from "../../infra/tokens.js";
import { ContentService, type CourseContent } from "../content/index.js";
import { ClassesService, ClassPolicy } from "../org/index.js";
import { ProgressService } from "../progress/index.js";
import type { AssignmentsApi, RunCompletion } from "./assignments.api.js";
import { assignmentCompletions, assignments } from "./assignments.schema.js";
import { dueOnProblem, isActive, MAX_ACTIVE_ASSIGNMENTS, PAST_ASSIGNMENTS, REVIEW_TITLE_RU, runMatches, seatStatus, summarize } from "./rules.js";

type Row = typeof assignments.$inferSelect;

/** Уроки и «Испытания места» открытых юнитов — что можно задать. */
function optionsOf(course: CourseContent | undefined): Schema<"AssignmentOption">[] {
  if (!course) return [];
  return course.units
    .filter((u) => u.status === "open")
    .flatMap((u) =>
      u.nodes
        .filter((n) => n.kind === "lesson" || n.kind === "place_test")
        .map((n) => ({ kind: n.kind as "lesson" | "place_test", lessonId: n.id, titleRu: n.titleRu, placeRu: u.place.titleRu, unitOrder: u.position })),
    );
}

/**
 * Задания учителя классу (таблицы assignments.schema.ts, ADR 0021). Учитель видит выполнение по номерам мест — без ников
 * и ПДн (ники — из GET /classes/{id}, ADR 0009); политика class-teacher: чужой класс — 403, нет класса — 404.
 * Выполнение пишет learning в транзакции завершения забега (recordCompletion). Методы принимают момент `now` —
 * так сид и тесты подменяют часы.
 */
@Injectable()
export class AssignmentsService implements AssignmentsApi {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: ClassPolicy,
    private readonly classes: ClassesService,
    private readonly content: ContentService,
    private readonly idempotency: IdempotencyStore,
    private readonly progress: ProgressService,
  ) {}

  // ── операции контракта ──

  async list(principal: Principal, classId: string, now: Date = new Date()): Promise<Schema<"ClassAssignments">> {
    await this.policy.requireTeacher(principal, classId);
    const today = ufaDate(now);
    const [rows, course] = await Promise.all([
      this.db
        .select()
        .from(assignments)
        .where(and(eq(assignments.classId, classId), isNull(assignments.cancelledAt)))
        .orderBy(asc(assignments.dueOn), asc(assignments.createdAt)),
      this.content.course().catch(() => undefined),
    ]);
    const active = rows.filter((r) => isActive(r.dueOn, today));
    const past = rows
      .filter((r) => !isActive(r.dueOn, today))
      .reverse()
      .slice(0, PAST_ASSIGNMENTS);
    const views = await this.views(classId, [...active, ...past], today);
    return {
      classId,
      maxActive: MAX_ACTIVE_ASSIGNMENTS,
      active: views.slice(0, active.length),
      past: views.slice(active.length),
      options: optionsOf(course),
    };
  }

  async create(principal: Principal, classId: string, body: Schema<"CreateAssignmentRequest">, idempotencyKey?: string, now: Date = new Date()): Promise<Schema<"ClassAssignment">> {
    return this.idempotency.run(`createClassAssignment:${classId}`, principal.accountId, idempotencyKey, requestFingerprint(body), async () => {
      const cls = await this.policy.requireTeacher(principal, classId);
      // Класс в архиве учебного года уже не учится: задание ему некому выполнять.
      if (cls.status === "archived") throw conflict("class_archived");
      const today = ufaDate(now);
      const due = dueOnProblem(body.dueOn, today);
      if (due) throw invalidField("/dueOn", due);
      const target = await this.target(body);
      const row = await this.db.transaction(async (tx) => {
        // Задания класса выдаются по очереди: без гонки за второе место.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`teletau:assignments:${classId}`}, 0))`);
        const live = await tx
          .select({ kind: assignments.kind, lessonId: assignments.lessonId })
          .from(assignments)
          .where(and(eq(assignments.classId, classId), isNull(assignments.cancelledAt), gte(assignments.dueOn, today)));
        if (live.some((a) => a.kind === body.kind && a.lessonId === target.lessonId)) throw conflict("assignment_exists");
        if (live.length >= MAX_ACTIVE_ASSIGNMENTS) throw conflict("assignment_limit");
        const [inserted] = await tx
          .insert(assignments)
          .values({
            classId,
            teacherAccountId: principal.accountId,
            kind: body.kind,
            lessonId: target.lessonId,
            titleRu: target.titleRu,
            placeRu: target.placeRu,
            dueOn: body.dueOn,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return inserted!;
      });
      return (await this.views(classId, [row], today))[0]!;
    });
  }

  async cancel(principal: Principal, classId: string, assignmentId: string, now: Date = new Date()): Promise<void> {
    await this.policy.requireTeacher(principal, classId);
    const [row] = await this.db
      .select({ id: assignments.id, cancelledAt: assignments.cancelledAt })
      .from(assignments)
      .where(and(eq(assignments.id, assignmentId), eq(assignments.classId, classId)));
    if (!row) throw notFound();
    if (row.cancelledAt) return;
    await this.db.update(assignments).set({ cancelledAt: now, updatedAt: now }).where(and(eq(assignments.id, assignmentId), isNull(assignments.cancelledAt)));
  }

  // ── для learning ──

  async forStudent(principal: Pick<Principal, "accountId" | "roles">, now: Date = new Date()): Promise<Schema<"StudentAssignment">[]> {
    if (!principal.roles.includes("student")) return [];
    const classIds = await this.studentClassIds(principal);
    if (classIds.length === 0) return [];
    const today = ufaDate(now);
    const rows = await this.db
      .select()
      .from(assignments)
      .where(and(inArray(assignments.classId, classIds), isNull(assignments.cancelledAt), gte(assignments.dueOn, today), lte(assignments.createdAt, now)))
      .orderBy(asc(assignments.dueOn), asc(assignments.createdAt));
    if (rows.length === 0) return [];
    const [completions, passed] = await Promise.all([
      this.db
        .select({ id: assignmentCompletions.assignmentId })
        .from(assignmentCompletions)
        .where(and(eq(assignmentCompletions.accountId, principal.accountId), inArray(assignmentCompletions.assignmentId, rows.map((r) => r.id)))),
      this.progress.lessonCompletions(principal.accountId),
    ]);
    // Урок или «Испытание», пройденные ещё до выдачи, — задание уже выполнено; повторение — только после выдачи.
    const done = new Set([...completions.map((c) => c.id), ...rows.filter((r) => r.lessonId && (passed.get(r.lessonId) ?? 0) > 0).map((r) => r.id)]);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      ...(r.lessonId ? { lessonId: r.lessonId } : {}),
      titleRu: r.titleRu,
      ...(r.placeRu ? { placeRu: r.placeRu } : {}),
      dueOn: r.dueOn,
      done: done.has(r.id),
    }));
  }

  async recordCompletion(tx: Db, c: RunCompletion): Promise<void> {
    if (!c.principal.roles.includes("student") || c.kind === "help_language") return;
    const classIds = await this.studentClassIds(c.principal);
    if (classIds.length === 0) return;
    const rows = await tx
      .select({ id: assignments.id, kind: assignments.kind, lessonId: assignments.lessonId })
      .from(assignments)
      .where(and(inArray(assignments.classId, classIds), isNull(assignments.cancelledAt), lte(assignments.createdAt, c.at)));
    const matched = rows.filter((a) => runMatches(a, { kind: c.kind, lessonId: c.lessonId }));
    if (matched.length === 0) return;
    await tx
      .insert(assignmentCompletions)
      .values(matched.map((a) => ({ assignmentId: a.id, accountId: c.principal.accountId, runId: c.runId, completedAt: c.at })))
      .onConflictDoNothing({ target: [assignmentCompletions.assignmentId, assignmentCompletions.accountId] });
  }

  // ── внутреннее ──

  private async studentClassIds(principal: Pick<Principal, "accountId" | "roles">): Promise<string[]> {
    const mine = await this.classes.myClasses({ accountId: principal.accountId, roles: ["student"] });
    return mine.filter((m) => m.role === "student").map((m) => m.id);
  }

  /** Что задаём: узел тропы открытого юнита нужного вида (или повторение слов). */
  private async target(body: Schema<"CreateAssignmentRequest">): Promise<{ lessonId: string | null; titleRu: string; placeRu: string | null }> {
    if (body.kind === "review") {
      if (body.lessonId !== undefined) throw invalidField("/lessonId", "У повторения слов урока нет");
      return { lessonId: null, titleRu: REVIEW_TITLE_RU, placeRu: null };
    }
    if (!body.lessonId) throw invalidField("/lessonId", "Выберите урок");
    const option = optionsOf(await this.content.course()).find((o) => o.lessonId === body.lessonId);
    if (!option || option.kind !== body.kind) throw invalidField("/lessonId", body.kind === "place_test" ? "Такого испытания нет на тропе" : "Такого урока нет на тропе");
    return { lessonId: option.lessonId, titleRu: option.titleRu, placeRu: option.placeRu };
  }

  /** Задания с выполнением по местам (ученики на местах сейчас). */
  private async views(classId: string, rows: readonly Row[], today: string): Promise<Schema<"ClassAssignment">[]> {
    if (rows.length === 0) return [];
    const [seats, completions] = await Promise.all([
      this.classes.seatViews(classId),
      this.db
        .select()
        .from(assignmentCompletions)
        .where(inArray(assignmentCompletions.assignmentId, rows.map((r) => r.id))),
    ]);
    const occupied = seats.flatMap((s) => (s.student ? [{ number: s.number, accountId: s.student.accountId }] : []));
    const doneAt = new Map(completions.map((c) => [`${c.assignmentId}:${c.accountId}`, c.completedAt]));
    // Урок или «Испытание», пройденные до выдачи задания, тоже засчитываются (моментом первого прохождения).
    const lessonIds = [...new Set(rows.flatMap((r) => (r.lessonId ? [r.lessonId] : [])))];
    const passes = await this.progress.firstPasses(occupied.map((s) => s.accountId), lessonIds);
    return rows.map((r) => {
      const seatRows = occupied.map((s) => {
        const before = r.lessonId ? passes.get(`${s.accountId}:${r.lessonId}`) : undefined;
        const completedAt = doneAt.get(`${r.id}:${s.accountId}`) ?? (before && before <= r.createdAt ? before : undefined);
        return { seatNumber: s.number, status: seatStatus({ dueOn: r.dueOn, today, completedAt }), ...(completedAt ? { completedAt: completedAt.toISOString() } : {}) };
      });
      return {
        id: r.id,
        kind: r.kind,
        ...(r.lessonId ? { lessonId: r.lessonId } : {}),
        titleRu: r.titleRu,
        ...(r.placeRu ? { placeRu: r.placeRu } : {}),
        dueOn: r.dueOn,
        createdAt: r.createdAt.toISOString(),
        active: isActive(r.dueOn, today),
        summary: summarize(seatRows),
        seats: seatRows,
      };
    });
  }
}
