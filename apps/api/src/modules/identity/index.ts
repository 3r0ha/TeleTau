// Публичный интерфейс модуля identity: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (identity.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { IdentityModule } from "./identity.module.js";
export { DEMO_STAFF, type DemoStaff } from "./staff-seed.js";
