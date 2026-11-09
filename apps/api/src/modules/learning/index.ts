// Публичный интерфейс модуля learning: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (learning.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { LearningModule } from "./learning.module.js";
export { LearningService } from "./learning.service.js";
export type { LearningApi } from "./learning.api.js";
export { LESSONS_BEFORE_DUELS } from "./run-plan.js";
