// Таблицы модуля assignments (ADR 0014, ADR 0021): задания учителя классу и их выполнение учениками. Ссылки на классы,
// аккаунты, уроки и забеги — простые uuid/text без внешних ключей на чужие модули. ПДн нет: только номера мест
// (через org) и идентификаторы аккаунтов.
import { sql } from "drizzle-orm";
import { check, date, index, pgEnum, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps, tstz } from "../../db/columns.js";

/** lesson — урок; place_test — «Испытание места»; review — повторить слова. */
export const assignmentKind = pgEnum("assignments_kind", ["lesson", "place_test", "review"]);

/**
 * Задание классу. Активно, пока не прошёл срок (due_on по Уфе включительно) и учитель его не снял (cancelled_at).
 * Название и место — снимок на момент выдачи: смена контента не меняет уже выданное задание.
 */
export const assignments = pgTable(
  "assignments",
  {
    id: primaryId(),
    classId: uuid("class_id").notNull(),
    teacherAccountId: uuid("teacher_account_id").notNull(),
    kind: assignmentKind("kind").notNull(),
    /** Узел тропы (content); у review — нет. */
    lessonId: text("lesson_id"),
    titleRu: text("title_ru").notNull(),
    placeRu: text("place_ru"),
    /** Последний день по Уфе (включительно). */
    dueOn: date("due_on").notNull(),
    cancelledAt: tstz("cancelled_at"),
    ...timestamps(),
  },
  (t) => [
    index("assignments_class_due_idx").on(t.classId, t.dueOn).where(sql`${t.cancelledAt} IS NULL`),
    check("assignments_lesson_by_kind", sql`(${t.kind} = 'review') = (${t.lessonId} IS NULL)`),
  ],
);

/**
 * Выполнение: первое завершение заданного урока (или повторения) учеником после выдачи задания. Только вставка
 * (повтор забега не перезаписывает момент выполнения).
 */
export const assignmentCompletions = pgTable(
  "assignment_completions",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    /** Забег, которым выполнено (learning.lesson_runs.id). */
    runId: uuid("run_id").notNull(),
    completedAt: tstz("completed_at").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "assignment_completions_pk", columns: [t.assignmentId, t.accountId] }), index("assignment_completions_account_idx").on(t.accountId)],
);
