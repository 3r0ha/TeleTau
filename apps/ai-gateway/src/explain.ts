// Функция 1 «Объяснение ошибки» (docs/04-ai-gigachat.md §3): закрытый сценарий — промпт из реестра
// (prompts/explain_error/vN.md), структурный ответ и валидаторы: фильтр безопасности и закрытый словарь (§5.3 —
// главная гарантия: GigaChat не может «научить» неверному башкирскому слову). Никаких ПДн: в контексте только задание,
// тип ошибки и (не всегда) ответ ученика; почта и телефоны вычищаются до сборки промпта.
import { z } from "zod";
import { render, section, type PromptTemplate } from "./prompts.js";
import { contentLine, learnerInput, unsafeOutput } from "./safety.js";

export const EXPLAIN_FEATURE = "explain_error";

/** Контекст от API: только учебные данные (правило «никаких ПДн в промптах», docs/04 §2.4) — лишние поля отвергаются. */
export const ExplainContext = z
  .object({
    /** Версия промпта `explain_error@vN`; нет — последняя версия функции. */
    promptId: z.string().min(1).max(64).optional(),
    exercise: z.object({
      /** Вид задания — только для формулировки, произвольные значения недопустимы. */
      kind: z.enum(["translate_ru_ba", "translate_ba_ru"]),
      /** Русское условие (у перевода с русского) или перевод (у выбора перевода). */
      promptRu: z.string().min(1).max(500),
      /** Башкирская фраза задания — у выбора перевода (её можно цитировать). */
      promptBa: z.string().max(500).optional(),
      /** Принятые варианты ответа — закрытый словарь промпта и валидатора. */
      accepted: z.array(z.string().min(1).max(500)).max(12),
    }),
    /** Ответ ученика как данные (§5.2). Кешируемые объяснения API запрашивает без него. */
    learnerAnswer: z.string().min(1).max(500).optional(),
    verdict: z.enum(["almost", "typo", "wrong"]),
    hint: z
      .object({
        expected: z.string().length(1),
        got: z.string().length(1),
      })
      .optional(),
  })
  .strict();
export type ExplainContext = z.infer<typeof ExplainContext>;

/** Секции, без которых промпт explain_error неполон: проверяются при старте шлюза. */
export const EXPLAIN_SECTIONS = ["system", "user", "learner_block", "task.translate_ru_ba", "task.translate_ba_ru", "error.almost", "error.typo", "error.wrong", "hint"] as const;

export function assertExplainPrompt(prompt: PromptTemplate): void {
  for (const name of EXPLAIN_SECTIONS) section(prompt, name);
}

/** Особые буквы башкирского алфавита (строчные и заглавные): их нет в русском — по ним слово «башкирское». */
const BASHKIR_LETTERS = /[әөүғҡңҙҫһӘӨҮҒҠҢҘҪҺ]/u;

export function allowedBashkir(context: ExplainContext): string[] {
  const out = [...context.exercise.accepted];
  if (context.exercise.promptBa) out.push(context.exercise.promptBa);
  return out;
}

/** Промпт сценария из реестра: система с правилами, пользователь — именованные блоки, LEARNER_INPUT — JSON-строка. */
export function buildExplainPrompt(context: ExplainContext, prompt: PromptTemplate): { system: string; user: string } {
  const where = prompt.promptId;
  const promptRu = contentLine(context.exercise.promptRu);
  const promptBa = contentLine(context.exercise.promptBa ?? "");
  const task = render(section(prompt, `task.${context.exercise.kind}`), { promptRu, promptBa }, where);
  const verdict = section(prompt, `error.${context.verdict}`);
  const error = context.hint
    ? render(section(prompt, "hint"), { error: verdict, expected: contentLine(context.hint.expected) || "?", got: contentLine(context.hint.got) || "?" }, where)
    : verdict;
  const learner = context.learnerAnswer === undefined ? undefined : learnerInput(context.learnerAnswer);
  const learnerBlock = learner === undefined ? "" : `\n${render(section(prompt, "learner_block"), { learner }, where)}\n`;
  const user = render(
    section(prompt, "user"),
    {
      task,
      allowed: allowedBashkir(context).map(contentLine).join("; "),
      error,
      learner_block: learnerBlock,
    },
    where,
  );
  return { system: section(prompt, "system"), user };
}

export type ExplainRejection = "json_invalid" | "text_empty" | "text_too_long" | "unsafe_output" | "closed_vocabulary";
export type ExplainValidation = { ok: true; text: string } | { ok: false; reason: ExplainRejection };

/** Цитаты в ответе: «…», “…”, „…“ и "…". */
const QUOTED_RE = /«([^«»]*)»|“([^“”]*)”|„([^„“”]*)[“”]|"([^"]*)"/gu;

/**
 * Разбор и валидация ответа модели: JSON → непустой текст ≤ 400 знаков → фильтр безопасности (ссылки, контакты,
 * просьбы личных данных) → закрытый словарь. Закрытый словарь (сравнение без регистра): любой токен с особой
 * башкирской буквой — слово из ALLOWED_BASHKIR; всё внутри кавычек — слова из ALLOWED_BASHKIR, из русского
 * условия задания или отдельные буквы (так башкирское слово без особых букв тоже не проходит в цитате).
 */
export function validateExplainOutput(raw: string, context: ExplainContext): ExplainValidation {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, reason: "json_invalid" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { ok: false, reason: "json_invalid" };
  }
  const text =
    typeof parsed === "object" && parsed !== null && typeof (parsed as { explanation?: unknown }).explanation === "string"
      ? (parsed as { explanation: string }).explanation.trim()
      : "";
  if (!text) return { ok: false, reason: "text_empty" };
  if (text.length > 400) return { ok: false, reason: "text_too_long" };
  if (unsafeOutput(text)) return { ok: false, reason: "unsafe_output" };

  const allowed = new Set(allowedBashkir(context).flatMap((s) => tokens(s)));
  for (const token of tokens(text)) {
    // Одиночная буква — это название буквы («здесь пишется ә»), не слово: неверному слову научить не может.
    if (token.length > 1 && BASHKIR_LETTERS.test(token) && !allowed.has(token)) return { ok: false, reason: "closed_vocabulary" };
  }
  const quotable = new Set([...allowed, ...tokens(context.exercise.promptRu)]);
  for (const m of text.matchAll(QUOTED_RE)) {
    const quoted = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    for (const token of tokens(quoted)) {
      if (token.length > 1 && !quotable.has(token)) return { ok: false, reason: "closed_vocabulary" };
    }
  }
  return { ok: true, text };
}

/** Слова текста: буквы (включая особые башкирские и дефис внутри слова), без пунктуации и цифр. */
function tokens(s: string): string[] {
  return s.match(/[\p{L}]+(?:-[\p{L}]+)*/gu)?.map((t) => t.toLocaleLowerCase("ba")) ?? [];
}
