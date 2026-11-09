export type { components, operations, paths } from "./generated/api.js";
import type { components, operations } from "./generated/api.js";

/** Схема из контракта по имени: `Schema<"Me">`, `Schema<"ClassDetail">`. Ручные DTO не нужны (CLAUDE.md, правило 1). */
export type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
/** operationId всех операций контракта — для матрицы авторизации и типизированных обработчиков. */
export type OperationId = keyof operations;

export type Health = components["schemas"]["Health"];
export type CheckStatus = components["schemas"]["CheckStatus"];
export type Problem = components["schemas"]["Problem"];
