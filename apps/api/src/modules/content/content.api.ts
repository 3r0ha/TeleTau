// Публичный интерфейс модуля content (docs/plans/M2.md, граф модулей: content — лист, ни от кого не зависит).
// Типы — внутренние для сервера: ключи ответов (AnswerKey) клиентам не уходят никогда — learning отдаёт
// упражнения забега по контракту (Schema<"RunExercise">) без ключей.
import type { Schema } from "@teletau/contracts";
import type { NodeKind } from "@teletau/domain-rules";

export type ReviewStatus = Schema<"ReviewStatus">;
export type SourceCitation = Schema<"SourceCitation">;
export type BaString = Schema<"BaString">;
export type AudioClip = Schema<"AudioClip">;

export interface UnitContent {
  id: string;
  position: number;
  status: Schema<"UnitState">;
  place: Schema<"Place">;
  topicRu: string;
  nodes: NodeContent[];
}

export interface NodeContent {
  /** = lessonId API. */
  id: string;
  unitId: string;
  position: number;
  kind: NodeKind;
  titleRu: string;
  icon?: Schema<"NodeIcon">;
  /** help_language: сколько дуэлей; lesson/place_test: число упражнений. */
  exerciseCount: number;
  /** Упражнений с проверкой ответа (без дуэлей) — из них собирается испытание для перехода (learning/jump.ts). */
  gradedCount: number;
}

/** Ключ ответа: принятые варианты (tiles/free), индекс верного варианта (choice), пары по порядку payload (pairs). Только на сервере. */
export type AnswerKey = { kind: "accepted"; accepted: BaString[] } | { kind: "choice"; correct: number } | { kind: "pairs" } | { kind: "none" };

export interface ExerciseContent {
  id: string;
  position: number;
  type: "tiles_ru_ba" | "choice_ba_ru" | "free_ru_ba" | "duel" | "match_pairs";
  /** То, что видит ученик (форма — по типу, content/schema/lesson.schema.json), без ключей. */
  payload: Record<string, unknown>;
  answerKey: AnswerKey;
  review: ReviewStatus;
  sources: SourceCitation[];
  /** duel: внешний id дуэли (иначе — из пула юнита). */
  duelRef?: string;
  /** Перевод или толкование для листа обратной связи. */
  meaningRu?: string;
  /** Слова словаря (WordContent.id), которые проверяет упражнение: его башкирские строки, кроме лишних плиток. */
  words?: string[];
}

export interface LessonContent extends NodeContent {
  newWords: BaString[];
  /** Слова словаря из new_words урока (WordContent.id) — после урока попадают в повторение. */
  wordIds?: string[];
  exercises: ExerciseContent[];
  contentVersion: number;
}

export interface CourseContent {
  id: string;
  contentVersion: number;
  units: UnitContent[];
}

/** Слово словаря курса (таблица words): строка из new_words урока с переводом и записью произношения. */
export interface WordContent {
  /** Ключ слова: слова answerTokens через пробел (регистр и пунктуация не важны). */
  id: string;
  /** Порядок первого появления по курсу. */
  position: number;
  word: BaString;
  translationRu: string;
  sources: SourceCitation[];
  /** Урок, где слово встретилось впервые. */
  lessonId: string;
}

/** Словарь текущего курса и версия контента. */
export interface Lexicon {
  courseId: string;
  contentVersion: number;
  words: WordContent[];
}

export interface ContentApi {
  /** Курс целиком (без упражнений); нет импортированного контента — ApiError 503 content_unavailable. */
  course(): Promise<CourseContent>;
  /** Узел тропы с упражнениями и ключами; нет такого — undefined. */
  lesson(lessonId: string): Promise<LessonContent | undefined>;
  /** Словарь текущего курса по порядку; нет контента — ApiError 503 content_unavailable. */
  words(): Promise<Lexicon>;
}
