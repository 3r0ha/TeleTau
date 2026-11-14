// Публичный интерфейс модуля learning: тропа, забеги уроков, проверка ответов, повторение слов и «Мой словарь» (граф:
// learning → content, corpus, consensus, progress). Проверка — matchAnswer из @teletau/bashkir-text (векторы
// contracts/test-vectors/answer-check), повторение — FSRS-6 из @teletau/domain-rules (векторы contracts/test-vectors/srs).
import type { Schema } from "@teletau/contracts";
import type { Principal } from "../../common/auth.js";

export interface LearningApi {
  course(principal: Principal, now?: Date): Promise<Schema<"Course">>;
  // `now` — подменённые часы для демо-сида и тестов (сутки и неделя по Уфе); контроллер его не передаёт.
  startRun(principal: Principal, lessonId: string, body: Schema<"StartLessonRunRequest">, now?: Date): Promise<Schema<"LessonRun">>;
  submitAttempt(principal: Principal, runId: string, body: Schema<"AttemptRequest">, now?: Date): Promise<Schema<"AttemptResult">>;
  /**
   * Объяснение ошибки (docs/04-ai-gigachat.md сценарий 1): GigaChat через ai-gateway с валидатором закрытого
   * словаря, кеш по (упражнение, класс ошибки), дневной лимит и методический шаблон при недоступности.
   */
  explainAttempt(principal: Principal, runId: string, attemptId: string, now?: Date): Promise<Schema<"AiExplanation">>;
  complete(principal: Principal, runId: string, now?: Date): Promise<Schema<"LessonRunSummary">>;
  /** Забег повторения из слов со сроком на сегодня (до 8); повторять нечего — забег без упражнений. */
  startReview(principal: Principal, body: Schema<"StartLessonRunRequest">, now?: Date): Promise<Schema<"LessonRun">>;
  /**
   * Испытание для перехода к закрытому месту (docs/02 §2): задания из «Испытаний» мест перед ним, где остались
   * непройденные уроки; итог — complete (поле jump). Место уже открыто — 409 jump_unavailable.
   */
  startJump(principal: Principal, unitId: string, body: Schema<"StartLessonRunRequest">, now?: Date): Promise<Schema<"LessonRun">>;
  /** «Мой словарь»: слова с карточками повторения, перевод и статус. */
  words(principal: Principal, now?: Date): Promise<Schema<"MyWords">>;
  /** Награды: полученные и прогресс к остальным (achievements.ts, векторы contracts/test-vectors/achievements). */
  achievements(principal: Principal, now?: Date): Promise<Schema<"MyAchievements">>;
  /** «Что в уроке» для учителя: слова, фразы и виды заданий узла тропы (lesson-preview.ts). Нет узла — 404. */
  preview(lessonId: string): Promise<Schema<"LessonPreview">>;
}
