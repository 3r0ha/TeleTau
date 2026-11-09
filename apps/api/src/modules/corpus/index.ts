// Публичный интерфейс модуля corpus: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (corpus.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { CorpusModule } from "./corpus.module.js";
export { CorpusService } from "./corpus.service.js";
export type { CorpusApi, CorpusItemsOptions, CorpusVariant, DuelItem } from "./corpus.api.js";
