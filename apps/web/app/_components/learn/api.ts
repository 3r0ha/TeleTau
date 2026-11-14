// Единственное место, где экраны ученика встречаются с API: клиент @teletau/session/api (токен, повтор на 401, таймаут,
// Problem Details) по сгенерированным путям контракта — типы запросов и ответов только оттуда (CLAUDE.md, правило 1).
import { api, unwrap } from "@teletau/session/api";
import type { Schema } from "@teletau/contracts";
import type { PublicDictionary } from "./model";

export const learnApi = {
  course: () => unwrap(api.GET("/api/v1/course")),
  progress: () => unwrap(api.GET("/api/v1/me/progress")),
  // accepts: веб умеет карточки «Новое слово» — сервер ставит их перед упражнениями с новыми словами.
  startRun: (lessonId: string, runId: string) =>
    unwrap(api.POST("/api/v1/lessons/{lessonId}/runs", { params: { path: { lessonId } }, body: { runId, accepts: ["word_intro"] } })),
  attempt: (runId: string, body: Schema<"AttemptRequest">) => unwrap(api.POST("/api/v1/lesson-runs/{runId}/attempts", { params: { path: { runId } }, body })),
  // Объяснение ошибки (docs/04-ai-gigachat.md сценарий 1): GigaChat через ai-gateway с запасным шаблоном.
  explain: (runId: string, attemptId: string) =>
    unwrap(api.POST("/api/v1/lesson-runs/{runId}/attempts/{attemptId}/explanation", { params: { path: { runId, attemptId } } })),
  complete: (runId: string) => unwrap(api.POST("/api/v1/lesson-runs/{runId}/complete", { params: { path: { runId } } })),
  league: () => unwrap(api.GET("/api/v1/leagues/current")),
  leagueResultSeen: (weekStart: string) => unwrap(api.POST("/api/v1/leagues/result-seen", { body: { weekStart } })),
  // Доска почёта (ТЗ §4.5): публичный топ школ и классов за период — агрегаты без имён и ников.
  leaderboard: (period: "day" | "week" | "month" | "year") => unwrap(api.GET("/api/v1/public/leaderboard", { params: { query: { period } } })),
  // Публичный словарь (ТЗ §5): витрина принятых пар на /dictionary — анонимно, без токена. CSV (format=csv)
  // витрина не запрашивает, но контракт допускает строку в ответе — неожиданную форму читаем как пустой словарь.
  dictionary: async (): Promise<PublicDictionary> => {
    const data = await unwrap(api.GET("/api/v1/public/dictionary"));
    return typeof data === "string" ? { generatedAt: "", langPair: "ba-ru", items: [] } : data;
  },
  hive: (classId: string) => unwrap(api.GET("/api/v1/classes/{id}/hive", { params: { path: { id: classId } } })),
  myCells: () => unwrap(api.GET("/api/v1/corpus/my-cells", { params: { query: { limit: 1 } } })),
  startReview: (runId: string) => unwrap(api.POST("/api/v1/reviews/runs", { body: { runId } })),
  // Испытание для перехода к закрытому месту (docs/02 §2): без карточек «Новое слово» — там вспоминают сами.
  startJump: (unitId: string, runId: string) => unwrap(api.POST("/api/v1/units/{unitId}/jump-runs", { params: { path: { unitId } }, body: { runId } })),
  words: () => unwrap(api.GET("/api/v1/me/words")),
  achievements: () => unwrap(api.GET("/api/v1/me/achievements")),
};
