// «Что в уроке» для учителя (getLessonPreview): слова, фразы и виды заданий узла тропы из контента курса.
// Чистая функция над типами модуля content — без запросов. Дуэли раскрываются только видом и числом: варианты и голоса
// остаются в consensus, сюда не попадают.
import type { Schema } from "@teletau/contracts";
import { wordKey, type BaString, type ExerciseContent, type LessonContent, type Lexicon, type UnitContent } from "../content/index.js";

type PreviewWord = Schema<"LessonPreviewWord">;
type TaskType = ExerciseContent["type"];

/** Строка из двух и больше слов — фраза (ключ словаря — слова через пробел). */
const isPhrase = (key: string) => key.includes(" ");

/** Башкирские строки задания с переводом, которые видит или собирает ученик (лишние плитки и неверные варианты — нет). */
function exerciseStrings(e: ExerciseContent): { word: BaString; translationRu: string }[] {
  const promptRu = typeof e.payload["promptRu"] === "string" ? e.payload["promptRu"] : undefined;
  switch (e.type) {
    case "tiles_ru_ba":
    case "free_ru_ba": {
      const first = e.answerKey.kind === "accepted" ? e.answerKey.accepted[0] : undefined;
      const ru = promptRu ?? e.meaningRu;
      return first && ru ? [{ word: first, translationRu: ru }] : [];
    }
    case "choice_ba_ru": {
      const prompt = e.payload["prompt"] as BaString | undefined;
      return prompt && e.meaningRu ? [{ word: prompt, translationRu: e.meaningRu }] : [];
    }
    case "match_pairs":
      return ((e.payload["pairs"] as { ba: BaString; ru: string }[] | undefined) ?? []).map((p) => ({ word: p.ba, translationRu: p.ru }));
    case "duel":
      return [];
  }
}

/**
 * Содержимое узла. Сначала new_words урока из словаря курса, затем строки заданий (без дуэлей) по порядку, без повторов.
 * Строка из нескольких слов — фраза. Отдельное слово из задания попадает в слова только у «Испытания места»: у него нет
 * своих new_words, а у урока слова — только новые. Перевод и запись — из словаря, если строка там есть, иначе — русская
 * сторона задания.
 */
export function lessonPreview(lesson: LessonContent, unit: UnitContent, lexicon: Lexicon): Schema<"LessonPreview"> {
  const dictionary = new Map(lexicon.words.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const words: PreviewWord[] = [];
  const phrases: PreviewWord[] = [];
  const add = (id: string, entry: Omit<PreviewWord, "id">) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    (isPhrase(id) ? phrases : words).push({ id, ...entry });
  };
  for (const id of lesson.wordIds ?? []) {
    const w = dictionary.get(id);
    if (w) add(id, { word: w.word, translationRu: w.translationRu });
  }
  for (const e of lesson.exercises) {
    for (const s of exerciseStrings(e)) {
      const id = wordKey(s.word.text);
      if (!isPhrase(id) && lesson.kind !== "place_test") continue;
      const known = dictionary.get(id);
      add(id, known ? { word: known.word, translationRu: known.translationRu } : s);
    }
  }

  const counts = new Map<TaskType, number>();
  if (lesson.kind === "help_language") counts.set("duel", lesson.exerciseCount);
  else for (const e of lesson.exercises) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const tasks = [...counts].filter(([, count]) => count > 0).map(([type, count]) => ({ type, count }));

  return {
    lessonId: lesson.id,
    kind: lesson.kind,
    titleRu: lesson.titleRu,
    unitId: unit.id,
    place: unit.place,
    topicRu: unit.topicRu,
    exerciseCount: lesson.exerciseCount,
    words,
    phrases,
    tasks,
  };
}
