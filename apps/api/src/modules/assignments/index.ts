// Публичный интерфейс модуля assignments: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (assignments.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { AssignmentsModule } from "./assignments.module.js";
export { AssignmentsService } from "./assignments.service.js";
export type { AssignmentsApi, RunCompletion } from "./assignments.api.js";
