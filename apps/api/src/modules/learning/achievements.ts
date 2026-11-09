// Награды ученика: тексты и значки (одинаковы для всех клиентов — их отдаёт сервер) и сборка входа правил
// computeAchievements (@teletau/domain-rules, векторы contracts/test-vectors/achievements). Чистые функции.
import type { Schema } from "@teletau/contracts";
import { ACHIEVEMENTS, type AchievementState, type AchievementsInput, type Verdict } from "@teletau/domain-rules";
import type { AchievementFacts } from "../progress/index.js";
import type { CourseContent } from "../content/index.js";

type Achievement = Schema<"Achievement">;
type AchievementText = Pick<Achievement, "titleRu" | "descriptionRu" | "icon">;

export const ACHIEVEMENT_TEXTS: Readonly<Record<string, AchievementText>> = {
  "first-lesson": { titleRu: "Первый урок", descriptionRu: "Пройди первый урок", icon: "footprints" },
  "perfect-lesson": { titleRu: "Без ошибок", descriptionRu: "Пройди урок без ошибок", icon: "seal-check" },
  "streak-3": { titleRu: "3 дня подряд", descriptionRu: "Занимайся 3 дня подряд", icon: "fire" },
  "streak-7": { titleRu: "7 дней подряд", descriptionRu: "Занимайся 7 дней подряд", icon: "fire" },
  "streak-30": { titleRu: "30 дней подряд", descriptionRu: "Занимайся 30 дней подряд", icon: "fire" },
  "goal-7": { titleRu: "7 целей дня", descriptionRu: "Выполни цель дня 7 раз", icon: "target" },
  "words-10": { titleRu: "10 слов", descriptionRu: "Выучи 10 слов", icon: "book-open" },
  "words-50": { titleRu: "50 слов", descriptionRu: "Выучи 50 слов", icon: "books" },
  "first-vote": { titleRu: "Первый голос", descriptionRu: "Проголосуй в «Помоги языку»", icon: "scales" },
  "votes-10": { titleRu: "10 голосов", descriptionRu: "Отдай 10 голосов в «Помоги языку»", icon: "scales" },
  "first-place": { titleRu: "Место пройдено", descriptionRu: "Пройди все уроки одного места", icon: "map-pin" },
  "all-places": { titleRu: "Вся тропа", descriptionRu: "Пройди все места", icon: "flag-banner" },
};

/** Завершённый забег ученика: вид, узел, сутки по Уфе, выполнил ли он цель дня, вердикты первых попыток. */
export interface CompletedRun {
  kind: string;
  lessonId: string;
  on: string;
  goalReached: boolean;
  firstAttempts: Verdict[];
}

/** Места курса для правила «место пройдено»: уроки и «Испытания места» каждого. */
export const coursePlaces = (course: CourseContent): AchievementsInput["places"] =>
  course.units.map((u) => ({ id: u.id, lessons: u.nodes.filter((n) => n.kind !== "help_language").map((n) => n.id) }));

/**
 * Вход правил по истории: уроки и цели дня — из забегов, слова — из «Моего словаря» (`words` — день первого
 * знакомства со словом, только слова словаря курса), серия, испытания для перехода и голоса — из progress. Голоса
 * `skipVotes` не считаются: так получается «до» для итога забега, голоса которого уже записаны.
 */
export function achievementsInput(args: {
  today: string;
  places: AchievementsInput["places"];
  runs: readonly CompletedRun[];
  words: readonly { wordId: string; on: string }[];
  known: ReadonlySet<string>;
  facts: AchievementFacts;
  skipVotes?: ReadonlySet<string>;
}): AchievementsInput {
  const skip = args.skipVotes ?? new Set<string>();
  return {
    today: args.today,
    lessons: args.runs
      .filter((r) => r.kind === "lesson" || r.kind === "place_test")
      .map((r) => ({ lessonId: r.lessonId, on: r.on, firstAttempts: r.firstAttempts })),
    skips: args.facts.skips,
    places: args.places,
    activeDays: args.facts.activeDays,
    goalDays: args.runs.filter((r) => r.goalReached).map((r) => r.on),
    words: args.words.filter((w) => args.known.has(w.wordId)).map((w) => w.on),
    votes: args.facts.votes.filter((v) => !skip.has(v.judgmentId)).map((v) => v.on),
  };
}

/** Награда для ответа API; незнакомая тексту награда — со своим id вместо названия (тексты и набор правятся вместе). */
export function achievementView(state: AchievementState): Achievement {
  const text = ACHIEVEMENT_TEXTS[state.id] ?? { titleRu: state.id, descriptionRu: "", icon: "star" };
  return {
    id: state.id,
    ...text,
    ...(state.earnedOn ? { earnedOn: state.earnedOn } : {}),
    progress: state.progress,
    target: state.target,
  };
}

/** Награды, которых не было в `before` и которые есть в `after`, — в порядке набора. */
export function newlyEarned(before: readonly AchievementState[], after: readonly AchievementState[]): Achievement[] {
  const had = new Set(before.filter((a) => a.earnedOn).map((a) => a.id));
  return after.filter((a) => a.earnedOn && !had.has(a.id)).map(achievementView);
}

/** Ответ GET /me/achievements. */
export function myAchievements(states: readonly AchievementState[]): Schema<"MyAchievements"> {
  return {
    earned: states.filter((a) => a.earnedOn).length,
    total: ACHIEVEMENTS.length,
    achievements: states.map(achievementView),
  };
}
