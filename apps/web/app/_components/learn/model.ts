// Типы экранов ученика — только из контракта (CLAUDE.md, правило 1): packages/contracts/openapi.yaml, операции
// getCourse, startLessonRun, submitLessonAttempt, completeLessonRun, getMyProgress, getCurrentLeague,
// markLeagueResultSeen, getClassHive, listMyCorpusCells, startReviewRun, listMyWords, listMyAchievements,
// getPublicLeaderboard. Здесь — короткие имена и выборки по полю `type`.
import type { Schema } from "@teletau/contracts";

export type Course = Schema<"Course">;
export type CourseUnit = Schema<"CourseUnit">;
export type CourseNode = Schema<"TrailNode">;
export type NodeKind = Schema<"NodeKind">;
/** Вид забега: узел тропы или review — повторение слов. */
export type RunKind = Schema<"RunKind">;
export type NodeState = Schema<"NodeState">;
export type NodeIcon = Schema<"NodeIcon">;
export type BaString = Schema<"BaString">;

export type LessonRun = Schema<"LessonRun">;
export type Exercise = Schema<"RunExercise">;
export type TilesExercise = Schema<"TilesExercise">;
export type ChoiceExercise = Schema<"ChoiceExercise">;
export type FreeExercise = Schema<"FreeInputExercise">;
export type DuelExercise = Schema<"DuelExercise">;
export type PairsExercise = Schema<"MatchPairsExercise">;
export type WordIntroExercise = Schema<"WordIntroExercise">;
export type PromptHint = Schema<"PromptHint">;
export type PairLink = Schema<"PairLink">;
export type AudioClip = Schema<"AudioClip">;
export type DuelChoice = Schema<"DuelChoice">;

export type Answer = Schema<"AttemptAnswer">;
export type AttemptResult = Schema<"AttemptResult">;
export type Verdict = Schema<"Verdict">;

export type LessonSummary = Schema<"LessonRunSummary">;
export type StreakState = Schema<"StreakState">;
export type StreakDay = Schema<"StreakDay">;
export type LeagueResult = Schema<"LeagueResult">;
export type LeagueTier = Schema<"LeagueTier">;

export type MyProgress = Schema<"MyProgress">;
export type LeagueStanding = Schema<"LeagueStanding">;
export type PublicLeaderboard = Schema<"PublicLeaderboard">;
export type PublicLeaderboardSchool = Schema<"PublicLeaderboardSchool">;
export type PublicLeaderboardClass = Schema<"PublicLeaderboardClass">;
export type PublicDictionary = Schema<"PublicDictionary">;
export type PublicDictionaryEntry = Schema<"PublicDictionaryEntry">;
export type ClassHive = Schema<"ClassHive">;
export type MyCellsPage = Schema<"MyCellsPage">;
export type DailyGoal = Schema<"DailyGoal">;
export type MyWords = Schema<"MyWords">;
export type MyWord = Schema<"MyWord">;
export type Achievement = Schema<"Achievement">;
export type MyAchievements = Schema<"MyAchievements">;
