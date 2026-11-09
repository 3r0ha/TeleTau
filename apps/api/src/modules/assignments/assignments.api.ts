// Публичный интерфейс модуля assignments (ADR 0021): задания учителя классу. Граф: assignments → org (политика
// class-teacher, места и классы ученика), content (уроки тропы). Его вызывает learning: задания на тропе, открытие
// заданного узла и выполнение — в транзакции завершения забега.
import type { Schema } from "@teletau/contracts";
import type { Principal } from "../../common/auth.js";
import type { Db } from "../../db/database.js";

export interface RunCompletion {
  principal: Pick<Principal, "accountId" | "roles">;
  runId: string;
  /** Вид забега (learning): lesson, place_test, help_language или review. */
  kind: string;
  lessonId: string;
  at: Date;
}

export interface AssignmentsApi {
  // ── операции контракта (`now` — подменённые часы для сида и тестов; контроллер его не передаёт) ──
  list(principal: Principal, classId: string, now?: Date): Promise<Schema<"ClassAssignments">>;
  create(principal: Principal, classId: string, body: Schema<"CreateAssignmentRequest">, idempotencyKey?: string, now?: Date): Promise<Schema<"ClassAssignment">>;
  cancel(principal: Principal, classId: string, assignmentId: string, now?: Date): Promise<void>;

  // ── для learning ──
  /** Активные задания классов ученика с отметкой «выполнено» (для GET /course). Не ученик — пусто. */
  forStudent(principal: Pick<Principal, "accountId" | "roles">, now?: Date): Promise<Schema<"StudentAssignment">[]>;
  /** Завершённый забег засчитывает подходящие задания классов ученика (в транзакции завершения). Повтор не дублирует. */
  recordCompletion(tx: Db, completion: RunCompletion): Promise<void>;
}
