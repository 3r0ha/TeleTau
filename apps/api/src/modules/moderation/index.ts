// Публичный интерфейс модуля moderation: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (moderation.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { ModerationModule } from "./moderation.module.js";
export { VerificationService, type TeacherStatus } from "./verification.service.js";
