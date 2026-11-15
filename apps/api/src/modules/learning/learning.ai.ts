// Объяснение ошибки после неверного ответа (docs/04-ai-gigachat.md §3 сценарий 1). GigaChat вызывается только
// через ai-gateway (ADR 0008); API собирает контекст без ПДн, ведёт дневной лимит (§5.5) и деградирует к
// методическим шаблонам при недоступности шлюза (§2.5). Валидатор закрытого словаря и фильтр безопасности — в шлюзе.
// Детям (kind: child) GigaChat не зовётся и кеш не читается (§5.5: младшим — только шаблоны), «Пары» и дуэли — тоже шаблон.
//
// Кеш — только у объяснений без ответа ученика: ключ — упражнение, класс ошибки, версия промпта и хеш контекста
// (условие, принятые варианты, буква-подсказка), поэтому смена контента или промпта даёт новый ключ, а текст ученика
// в общий кеш не попадает. Неверный ответ («wrong») объясняется по самому ответу — такой вызов не кешируется.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { Schema } from "@teletau/contracts";
import { ufaDate, ufaDayNumber, ufaMidnight } from "@teletau/domain-rules";
import type { Principal } from "../../common/auth.js";
import { sha256Hex } from "../../common/crypto.js";
import { conflict, notFound, tooManyRequests } from "../../common/problem.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { aiExplanations, aiExplanationUses, attempts, lessonRuns } from "./learning.schema.js";
import type { PlanItem, RunPlan } from "./run-plan.js";

/** Версия промпта реестра шлюза (apps/ai-gateway/prompts/explain_error/v1.md): входит в ключ кеша. */
export const EXPLAIN_PROMPT_ID = "explain_error@v1";

type Verdict = "almost" | "typo" | "wrong";
type Hint = { expected: string; got: string };
type RunExerciseType = PlanItem["view"]["type"];

/** Контекст шлюза: только учебные данные (правило «никаких ПДн в промптах», docs/04 §2.4). */
export interface GatewayContext {
  promptId: string;
  exercise: { kind: "translate_ru_ba" | "translate_ba_ru"; promptRu: string; promptBa?: string; accepted: string[] };
  /** Только у живого (некешируемого) вызова по неверному ответу. */
  learnerAnswer?: string;
  verdict: Verdict;
  hint?: Hint;
}

/**
 * Методическая подсказка по классу ошибки и виду задания (docs/04 §3 «деградация без AI») — пишет методист, не
 * модель. Не повторяет лист ответа (вердикт, верный ответ, «повторим в конце урока»), а даёт, на что смотреть.
 */
export function templateExplanation(verdict: Verdict, hint?: Hint, exercise?: RunExerciseType): string {
  switch (verdict) {
    case "almost":
      return hint && hint.got !== hint.expected
        ? `«${hint.expected}» и «${hint.got}» обозначают разные звуки. Букву «${hint.expected}» набирай с панели букв над полем ввода.`
        : "В башкирском девять своих букв: ә ө ү ғ ҡ ң ҙ ҫ һ. Набирай их с панели букв над полем ввода, обычная клавиатура подставит похожую русскую.";
    case "typo":
      return "Длинное башкирское слово сверяй по частям: сначала корень, потом каждый суффикс.";
    case "wrong":
      switch (exercise) {
        case "tiles_ru_ba":
          return "Сверь порядок слов с верным ответом: в башкирском он часто не совпадает с русским.";
        case "free_ru_ba":
          return "Сравни свой ответ с верным по словам и найди слово, которое не совпало. Прочитай верный вариант вслух.";
        case "choice_ba_ru":
          return "Прочитай башкирское слово вслух и свяжи его с верным переводом.";
        default:
          return "Прочитай верный ответ вслух по словам.";
      }
  }
}


/** Контекст для шлюза без ответа ученика или null (упражнение без одного «верного ответа»). */
export function gatewayContext(item: PlanItem, verdict: Verdict, hint?: Hint): GatewayContext | null {
  const base = { promptId: EXPLAIN_PROMPT_ID, verdict, ...(hint ? { hint } : {}) };
  switch (item.view.type) {
    case "choice_ba_ru": {
      if (item.key.type !== "choice") return null;
      const promptBa = item.view.prompt;
      const promptRu = item.key.meaningRu ?? "";
      if (!promptBa || !promptRu) return null;
      return { ...base, exercise: { kind: "translate_ba_ru", promptRu, promptBa, accepted: [promptBa] } };
    }
    case "tiles_ru_ba":
    case "free_ru_ba": {
      if (item.key.type !== "tiles" && item.key.type !== "free") return null;
      const promptRu = item.view.promptRu;
      const accepted = item.key.accepted.map((a) => a.text);
      if (!promptRu || accepted.length === 0) return null;
      return { ...base, exercise: { kind: "translate_ru_ba", promptRu, accepted } };
    }
    default:
      return null;
  }
}

/** Ключ кеша по содержимому контекста: условие, принятые варианты, класс ошибки, буква-подсказка и версия промпта. */
export function contextHash(context: GatewayContext): string {
  const { exercise, verdict, hint, promptId } = context;
  return sha256Hex(JSON.stringify({ promptId, verdict, hint: hint ?? null, exercise: { kind: exercise.kind, promptRu: exercise.promptRu, promptBa: exercise.promptBa ?? null, accepted: exercise.accepted } }));
}

/** Ответ ученика одной строкой: у плиток — тексты по id, у выбора — текст варианта, у ввода — как есть. */
export function answerAsText(item: PlanItem, answer: unknown): string | null {
  if (typeof answer !== "object" || answer === null) return null;
  const a = answer as { type?: string; text?: unknown; tileIds?: unknown; optionId?: unknown };
  switch (a.type) {
    case "text":
      return typeof a.text === "string" && a.text.trim() ? a.text.trim().slice(0, 500) : null;
    case "tiles": {
      const key = item.key;
      if (!Array.isArray(a.tileIds) || key.type !== "tiles") return null;
      const words = a.tileIds.map((id) => key.tiles[String(id)]);
      return words.every(Boolean) && words.length > 0 ? words.join(" ").slice(0, 500) : null;
    }
    case "choice": {
      if (item.view.type !== "choice_ba_ru" || item.key.type !== "choice") return null;
      const option = item.view.options.find((o) => o.id === a.optionId);
      return option?.textRu ?? null;
    }
    default:
      return null;
  }
}

@Injectable()
export class AiExplanations {
  private readonly logger = new Logger(AiExplanations.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async explain(principal: Principal, runId: string, attemptId: string, now: Date = new Date()): Promise<Schema<"AiExplanation">> {
    const [run] = await this.db.select().from(lessonRuns).where(eq(lessonRuns.id, runId));
    // Чужой забег и чужая попытка неотличимы от несуществующих — как у попыток (contract, submitLessonAttempt).
    if (!run || run.accountId !== principal.accountId) throw notFound();
    const [attempt] = await this.db.select().from(attempts).where(eq(attempts.id, attemptId));
    if (!attempt || attempt.runId !== run.id) throw notFound();
    if (attempt.verdict === "correct" || attempt.verdict === "recorded") throw conflict("explanation_not_applicable");

    const verdict = attempt.verdict as Verdict;
    await this.takeDailyUse(principal.accountId, now);

    const plan = run.plan as RunPlan;
    const item = plan.items.find((i) => i.id === attempt.runExerciseId);
    if (!item) throw notFound();
    const hint = hintOf(attempt.result as { hint?: Hint });
    const template = { text: templateExplanation(verdict, hint, item.view.type), source: "template" as const };

    // Детям — только шаблоны (docs/04 §5.5): ни кеша, ни шлюза.
    if (principal.kind === "child") return template;
    const context = gatewayContext(item, verdict, hint);
    if (!context || !item.exerciseId) return template;

    // Неверный ответ — объяснение по самому ответу ученика: живой вызов, в общий кеш не идёт.
    const answer = verdict === "wrong" ? answerAsText(item, attempt.answer) : null;
    if (answer) {
      const ai = await this.callGateway({ ...context, learnerAnswer: answer });
      return ai ? { text: ai, source: "ai" } : template;
    }

    // Кеш: одинаковый контекст без ответа ученика у всех получает один ответ — без повторного вызова GigaChat.
    const hash = contextHash(context);
    const key = and(
      eq(aiExplanations.exerciseId, item.exerciseId),
      eq(aiExplanations.errorClass, verdict),
      eq(aiExplanations.promptId, context.promptId),
      eq(aiExplanations.contextHash, hash),
    );
    const [cached] = await this.db.select({ text: aiExplanations.text }).from(aiExplanations).where(key);
    if (cached) return { text: cached.text, source: "ai" };
    const ai = await this.callGateway(context);
    if (!ai) return template;
    await this.db
      .insert(aiExplanations)
      .values({ exerciseId: item.exerciseId, errorClass: verdict, promptId: context.promptId, contextHash: hash, text: ai })
      .onConflictDoNothing();
    return { text: ai, source: "ai" };
  }

  /**
   * Дневной лимит (docs/04 §5.5) одним атомарным запросом: счётчик растёт, только пока он меньше лимита — два
   * параллельных запроса на последнем объяснении не проходят оба. Растёт и на шаблонах: лимит защищает от спама кнопкой.
   */
  private async takeDailyUse(accountId: string, now: Date): Promise<void> {
    const limit = this.config.AI_EXPLANATION_LIMIT;
    const day = ufaDate(now);
    const taken =
      limit > 0
        ? await this.db
            .insert(aiExplanationUses)
            .values({ accountId, day, count: 1 })
            .onConflictDoUpdate({
              target: [aiExplanationUses.accountId, aiExplanationUses.day],
              set: { count: sql`${aiExplanationUses.count} + 1` },
              setWhere: sql`${aiExplanationUses.count} < ${limit}`,
            })
            .returning({ n: aiExplanationUses.count })
        : [];
    if (taken.length === 0) {
      const nextDay = ufaMidnight(ufaDayNumber(now) + 1);
      throw tooManyRequests(Math.max(1, Math.ceil((nextDay.getTime() - now.getTime()) / 1000)), "ai_explanation_limit");
    }
  }

  /**
   * Вызов шлюза: таймаут (AI_GATEWAY_TIMEOUT_MS) и любой сбой — null, деградация к шаблону без ошибки для пользователя
   * (docs/04 §2.5). Причина отказа шлюза — в журнал: статус, код и причина валидатора, без контекста и текстов.
   */
  private async callGateway(context: GatewayContext): Promise<string | null> {
    let res: Response;
    try {
      res = await fetch(`${this.config.AI_GATEWAY_URL}/v1/explain-error`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.config.AI_GATEWAY_TOKEN ? { Authorization: `Bearer ${this.config.AI_GATEWAY_TOKEN}` } : {}),
        },
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(this.config.AI_GATEWAY_TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.warn(`ai-gateway: no response (${e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network"}), template used`);
      return null;
    }
    const body = (await res.json().catch(() => undefined)) as { text?: unknown; code?: unknown; reason?: unknown } | undefined;
    if (!res.ok) {
      const code = token(body?.code) ?? "unknown";
      const reason = token(body?.reason) ? ` ${token(body?.reason)}` : "";
      this.logger.warn(`ai-gateway: ${res.status} ${code}${reason}, template used`);
      return null;
    }
    const text = body?.text;
    if (typeof text !== "string" || text.length < 1 || text.length > 400) {
      this.logger.warn("ai-gateway: malformed response, template used");
      return null;
    }
    return text;
  }
}

/** Код или причина отказа шлюза для журнала: только машинный идентификатор, иначе — ничего. */
const token = (v: unknown): string | undefined => (typeof v === "string" && /^[a-z_]{1,40}$/.test(v) ? v : undefined);

function hintOf(result: { hint?: Hint }): Hint | undefined {
  const h = result?.hint;
  return h && typeof h.expected === "string" && typeof h.got === "string" ? { expected: h.expected, got: h.got } : undefined;
}
