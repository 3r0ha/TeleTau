// Публичный интерфейс модуля admin: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (admin.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { AdminModule } from "./admin.module.js";
export { AuditService, type AuditAction, type AuditMetadata, type AuditRecord } from "./audit.service.js";
