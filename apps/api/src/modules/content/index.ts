// Публичный интерфейс модуля content: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (content.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { ContentModule } from "./content.module.js";
export { ContentService } from "./content.service.js";
// Чистые функции разбора контента: ключ слова словаря и плитки строки (те же, что у импорта).
export { tileWords, wordKey } from "./content-import.js";
export type {
  AnswerKey,
  AudioClip,
  BaString,
  ContentApi,
  CourseContent,
  ExerciseContent,
  LessonContent,
  Lexicon,
  NodeContent,
  ReviewStatus,
  SourceCitation,
  UnitContent,
  WordContent,
} from "./content.api.js";
