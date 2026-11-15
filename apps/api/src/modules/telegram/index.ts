// Публичный интерфейс модуля telegram: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (telegram.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { TelegramModule } from "./telegram.module.js";
export { TelegramService } from "./telegram.service.js";
export { TelegramLinks } from "./telegram-links.js";
export { verifyInitData, type InitDataCheck } from "./init-data.js";
