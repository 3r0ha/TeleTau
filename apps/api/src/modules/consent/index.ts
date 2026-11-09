// Публичный интерфейс модуля consent: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (consent.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { ConsentModule } from "./consent.module.js";
export { ConsentService, type CurrentDocumentText, type SeatConsent } from "./consent.service.js";
