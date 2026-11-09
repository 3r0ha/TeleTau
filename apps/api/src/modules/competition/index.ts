// Публичный интерфейс модуля competition: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (competition.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { CompetitionModule } from "./competition.module.js";
export { CompetitionService } from "./competition.service.js";
export type { AgeGroup, CompetitionApi } from "./competition.api.js";
