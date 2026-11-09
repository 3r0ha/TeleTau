// Единственное место, где экраны ученика встречаются с API: клиент @teletau/session/api (токен, повтор на 401, таймаут,
// Problem Details) по сгенерированным путям контракта — типы запросов и ответов только оттуда (CLAUDE.md, правило 1).
import { api, unwrap } from "@teletau/session/api";
import type { Schema } from "@teletau/contracts";

export const learnApi = {
  course: () => unwrap(api.GET("/api/v1/course")),
  progress: () => unwrap(api.GET("/api/v1/me/progress")),
  // accepts: веб умеет карточки «Новое слово» — сервер ставит их перед упражнениями с новыми словами.
  startRun: (lessonId: string, runId: string) =>
    unwrap(api.POST("/api/v1/lessons/{lessonId}/runs", { params: { path: { lessonId } }, body: { runId, accepts: ["word_intro"] } })),
  attempt: (runId: string, body: Schema<"AttemptRequest">) => unwrap(api.POST("/api/v1/lesson-runs/{runId}/attempts", { params: { path: { runId } }, body })),
  complete: (runId: string) => unwrap(api.POST("/api/v1/lesson-runs/{runId}/complete", { params: { path: { runId } } })),
  league: () => unwrap(api.GET("/api/v1/leagues/current")),
  leagueResultSeen: (weekStart: string) => unwrap(api.POST("/api/v1/leagues/result-seen", { body: { weekStart } })),
  hive: (classId: string) => unwrap(api.GET("/api/v1/classes/{id}/hive", { params: { path: { id: classId } } })),
  myCells: () => unwrap(api.GET("/api/v1/corpus/my-cells", { params: { query: { limit: 1 } } })),
  startReview: (runId: string) => unwrap(api.POST("/api/v1/reviews/runs", { body: { runId } })),
  // Испытание для перехода к закрытому месту (docs/02 §2): без карточек «Новое слово» — там вспоминают сами.
  startJump: (unitId: string, runId: string) => unwrap(api.POST("/api/v1/units/{unitId}/jump-runs", { params: { path: { unitId } }, body: { runId } })),
  words: () => unwrap(api.GET("/api/v1/me/words")),
  achievements: () => unwrap(api.GET("/api/v1/me/achievements")),
};
