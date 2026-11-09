// Ответы демо-учеников на упражнения забега — чистые функции. Упражнение забега (без ключей, как его видит ученик)
// сопоставляется с упражнением контента по типу и подсказке; ключ ответа берётся из ContentService.lesson (публичный
// интерфейс модуля content). Неверные ответы — из того, что есть в упражнении (чужой вариант, плитки в обратном
// порядке, русское слово вместо башкирского); «почти» — особая буква заменена русской парой. Новых башкирских слов
// сид не придумывает (CLAUDE.md, правило 6).
import type { Schema } from "@teletau/contracts";
import type { ExerciseContent, LessonContent } from "../modules/content/index.js";

type RunExercise = Schema<"RunExercise">;
type Answer = Schema<"AttemptAnswer">;

/** Особые буквы башкирского → русская пара (как путает ребёнок без панели букв). */
const RUSSIAN_PAIR: Record<string, string> = {
  ә: "а",
  ө: "о",
  ү: "у",
  ғ: "г",
  ҡ: "к",
  ң: "н",
  ҙ: "з",
  ҫ: "с",
  һ: "х",
};

/** Слова плиток — как их режет импорт контента (content-import.ts, tileWords): по пробелам, без пунктуации по краям. */
export const tileWords = (text: string) =>
  text
    .split(/\s+/u)
    .map((w) => w.replace(/^\p{P}+|\p{P}+$/gu, ""))
    .filter((w) => w.length > 0);

/** Упражнение контента, из которого собрано упражнение забега (дуэли — не сопоставляются). */
export function contentExercise(
  view: RunExercise,
  lesson: LessonContent,
): ExerciseContent | undefined {
  return lesson.exercises.find((e) => {
    if (e.type !== view.type) return false;
    if (view.type === "choice_ba_ru")
      return (e.payload["prompt"] as { text?: string } | undefined)?.text === view.prompt;
    if (view.type === "tiles_ru_ba" || view.type === "free_ru_ba")
      return e.payload["promptRu"] === view.promptRu;
    if (view.type === "match_pairs") {
      const texts = pairsOf(e)
        .map((p) => p.ba.text)
        .sort();
      return (
        texts.join("\n") ===
        view.left
          .map((w) => w.text)
          .sort()
          .join("\n")
      );
    }
    return false;
  });
}

/** Пары упражнения «Пары» из контента: башкирская строка и перевод. */
const pairsOf = (e: ExerciseContent) =>
  (e.payload["pairs"] as { ba: { text: string }; ru: string }[] | undefined) ?? [];

const accepted = (e: ExerciseContent) =>
  e.answerKey.kind === "accepted" ? e.answerKey.accepted[0]!.text : undefined;

/** Верный ответ. */
export function correctAnswer(view: RunExercise, lesson: LessonContent): Answer {
  const e = contentExercise(view, lesson);
  if (!e)
    throw new Error(`сид: упражнение «${view.id}» (${view.type}) не найдено в уроке ${lesson.id}`);
  switch (view.type) {
    case "tiles_ru_ba": {
      const free = [...view.tiles];
      const tileIds = tileWords(accepted(e)!).map((w) => {
        const i = free.findIndex((t) => t.text === w);
        if (i < 0) throw new Error(`сид: нет плитки «${w}» в упражнении ${e.id}`);
        return free.splice(i, 1)[0]!.id;
      });
      return { type: "tiles", tileIds };
    }
    case "choice_ba_ru": {
      if (e.answerKey.kind !== "choice") throw new Error(`сид: у ${e.id} нет ключа выбора`);
      const text = (e.payload["optionsRu"] as string[])[e.answerKey.correct];
      const option = view.options.find((o) => o.textRu === text);
      if (!option) throw new Error(`сид: нет верного варианта в упражнении ${e.id}`);
      return { type: "choice", optionId: option.id };
    }
    case "free_ru_ba":
      return { type: "text", text: accepted(e)! };
    case "match_pairs": {
      const pairs = view.left.map((w) => {
        const ru = pairsOf(e).find((p) => p.ba.text === w.text)?.ru;
        const right = view.right.find((r) => r.textRu === ru);
        if (!right) throw new Error(`сид: нет перевода для «${w.text}» в упражнении ${e.id}`);
        return { left: w.id, right: right.id };
      });
      return { type: "pairs", pairs };
    }
    case "duel":
      throw new Error("сид: дуэль не оценивается — голос выбирает world.ts");
    case "word_intro":
      throw new Error("сид: у карточки «Новое слово» ответа нет — world.ts её пропускает");
  }
}

/** Первая особая буква заменена русской парой; особых букв нет — undefined. */
export function almostText(text: string): string | undefined {
  const chars = [...text];
  const i = chars.findIndex((c) => RUSSIAN_PAIR[c.toLowerCase()] !== undefined);
  if (i < 0) return undefined;
  const c = chars[i]!;
  const pair = RUSSIAN_PAIR[c.toLowerCase()]!;
  chars[i] = c === c.toLowerCase() ? pair : pair.toUpperCase();
  return chars.join("");
}

/** Ошибочный ответ: «почти» (если просили и можно) или неверно. */
export function mistakenAnswer(
  view: RunExercise,
  lesson: LessonContent,
  kind: "wrong" | "almost",
): Answer {
  const right = correctAnswer(view, lesson);
  switch (right.type) {
    case "tiles": {
      const ids = [...right.tileIds].reverse();
      if (ids.join() !== right.tileIds.join()) return { type: "tiles", tileIds: ids };
      const spare = (view as Schema<"TilesExercise">).tiles.find(
        (t) => !right.tileIds.includes(t.id),
      );
      return { type: "tiles", tileIds: spare ? [...right.tileIds, spare.id] : ids };
    }
    case "choice": {
      const other = (view as Schema<"ChoiceExercise">).options.find(
        (o) => o.id !== right.optionId,
      )!;
      return { type: "choice", optionId: other.id };
    }
    case "pairs": {
      // Первые два перевода перепутаны.
      const [a, b, ...rest] = right.pairs;
      return a && b
        ? {
            type: "pairs",
            pairs: [{ left: a.left, right: b.right }, { left: b.left, right: a.right }, ...rest],
          }
        : right;
    }
    case "text": {
      const almost = kind === "almost" ? almostText(right.text) : undefined;
      // Неверно — русское слово задания вместо башкирского.
      return { type: "text", text: almost ?? (view as Schema<"FreeInputExercise">).promptRu };
    }
    default:
      return right;
  }
}

/** Шпаргалка урока для ведущего и сквозного теста: подсказка → ответ (тексты — из контента, ждут проверки носителем). */
export interface AnswerSheetRow {
  type: ExerciseContent["type"];
  prompt: string;
  /** tiles — слова плиток по порядку; choice — верный русский вариант; free — ответ. */
  answer: string[];
  /** free: ответ с русской буквой вместо особой — даёт «Почти!». */
  almost?: string;
  /** choice: неверный вариант — даёт «Пока не так». */
  wrong?: string;
}

export function answerSheet(lesson: LessonContent): AnswerSheetRow[] {
  return lesson.exercises.flatMap((e): AnswerSheetRow[] => {
    switch (e.type) {
      case "tiles_ru_ba":
        return [
          { type: e.type, prompt: String(e.payload["promptRu"]), answer: tileWords(accepted(e)!) },
        ];
      case "choice_ba_ru": {
        if (e.answerKey.kind !== "choice") return [];
        const options = e.payload["optionsRu"] as string[];
        const correct = e.answerKey.correct;
        return [
          {
            type: e.type,
            prompt: (e.payload["prompt"] as { text: string }).text,
            answer: [options[correct]!],
            wrong: options.find((_, i) => i !== correct)!,
          },
        ];
      }
      case "free_ru_ba": {
        const text = accepted(e)!;
        const almost = almostText(text);
        return [
          {
            type: e.type,
            prompt: String(e.payload["promptRu"]),
            answer: [text],
            ...(almost ? { almost } : {}),
          },
        ];
      }
      case "match_pairs":
        return [
          {
            type: e.type,
            prompt: "Соедини пары",
            answer: pairsOf(e).map((p) => `${p.ba.text} — ${p.ru}`),
          },
        ];
      case "duel":
        return [];
    }
  });
}
