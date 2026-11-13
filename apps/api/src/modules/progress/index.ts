// Публичный интерфейс модуля progress: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (progress.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { ProgressModule } from "./progress.module.js";
export { ProgressService } from "./progress.service.js";
export type { AchievementFacts, LearnerTotals, LessonCompletionInput, LessonCompletionResult, PeriodTotals, ProgressApi, VoteSettlement } from "./progress.api.js";
