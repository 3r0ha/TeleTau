// Объяснение ошибки после неверного ответа (docs/04-ai-gigachat.md §3 сценарий 1). GigaChat вызывается только
// через ai-gateway (ADR 0008); API собирает контекст без ПДн, кеширует по (упражнение, класс ошибки), ведёт
// дневной лимит (§5.5) и деградирует к методическим шаблонам при недоступности шлюза (§2.5). Валидатор
// закрытого словаря — в шлюзе: башкирские слова в объяснении только из принятых вариантов задания.
// Детям (kind: child) GigaChat не зовётся (§5.5: младшим — только шаблоны), «Пары» и дуэли — тоже шаблон.
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { Schema } from "@teletau/contracts";
import { ufaDate, ufaDayNumber, ufaMidnight } from "@teletau/domain-rules";
import type { Principal } from "../../common/auth.js";
import { conflict, notFound, tooManyRequests } from "../../common/problem.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { aiExplanations, aiExplanationUses, attempts, lessonRuns } from "./learning.schema.js";
import type { PlanItem, RunPlan } from "./run-plan.js";

/** Контекст шлюза: только учебные данные (правило «никаких ПДн в промптах», docs/04 §2.4). */
export interface GatewayContext {
  exercise: { kind: "translate_ru_ba" | "translate_ba_ru"; promptRu: string; promptBa?: string; accepted: string[] };
  learnerAnswer: string;
  verdict: "almost" | "typo" | "wrong";
  hint?: { expected: string; got: string };
}

/** Методический шаблон по классу ошибки (docs/04 §3 «деградация без AI») — пишет методист, не модель. */
export function templateExplanation(verdict: "almost" | "typo" | "wrong", hint?: { expected: string; got: string }): string {
  switch (verdict) {
    case "almost":
      return hint && hint.got !== hint.expected
        ? `Почти! В этом слове пишется особая буква башкирского алфавита «${hint.expected}», а не «${hint.got}». Сравни по буквам с верным ответом — и она запомнится сама.`
        : "Почти! В этом слове особая буква башкирского алфавита — сверь его по буквам с верным ответом.";
    case "typo":
      return "Ответ засчитан, но в слове не хватило одной буквы. Прочитай верный ответ по буквам — так слово закрепится.";
    case "wrong":
      return "Ничего страшного — на ошибках и учатся. Посмотри на верный ответ и произнеси его вслух: задание вернётся в конце урока.";
  }
}

/** Контекст для шлюза или null (упражнение без одного «верного ответа» или пустой ответ ученика). */
export function gatewayContext(item: PlanItem, learnerAnswer: unknown, verdict: "almost" | "typo" | "wrong", hint?: { expected: string; got: string }): GatewayContext | null {
  const answer = answerAsText(item, learnerAnswer);
  if (!answer) return null;
  switch (item.view.type) {
    case "choice_ba_ru": {
      if (item.key.type !== "choice") return null;
      const promptBa = item.view.prompt;
      const promptRu = item.key.meaningRu ?? "";
      if (!promptBa || !promptRu) return null;
      return { exercise: { kind: "translate_ba_ru", promptRu, promptBa, accepted: [promptBa] }, learnerAnswer: answer, verdict, ...(hint ? { hint } : {}) };
    }
    case "tiles_ru_ba":
    case "free_ru_ba": {
      if (item.key.type !== "tiles" && item.key.type !== "free") return null;
      const promptRu = item.view.promptRu;
      const accepted = item.key.accepted.map((a) => a.text);
      if (!promptRu || accepted.length === 0) return null;
      return { exercise: { kind: "translate_ru_ba", promptRu, accepted }, learnerAnswer: answer, verdict, ...(hint ? { hint } : {}) };
    }
    default:
      return null;
  }
}

/** Ответ ученика одной строкой: у плиток — тексты по id, у выбора — текст варианта, у ввода — как есть. */
function answerAsText(item: PlanItem, answer: unknown): string | null {
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

    const verdict = attempt.verdict as "almost" | "typo" | "wrong";
    const day = ufaDate(now);
    // Дневной лимит (docs/04 §5.5): счётчик растёт и на шаблонах — лимит защищает от спама кнопкой.
    const [taken] = await this.db
      .select({ n: aiExplanationUses.count })
      .from(aiExplanationUses)
      .where(sql`${aiExplanationUses.accountId} = ${principal.accountId} AND ${aiExplanationUses.day} = ${day}`);
    if ((taken?.n ?? 0) >= this.config.AI_EXPLANATION_LIMIT) {
      const nextDay = ufaMidnight(ufaDayNumber(now) + 1);
      throw tooManyRequests(Math.max(1, Math.ceil((nextDay.getTime() - now.getTime()) / 1000)), "ai_explanation_limit");
    }
    await this.db
      .insert(aiExplanationUses)
      .values({ accountId: principal.accountId, day, count: 1 })
      .onConflictDoUpdate({ target: [aiExplanationUses.accountId, aiExplanationUses.day], set: { count: sql`${aiExplanationUses.count} + 1` } });

    const plan = run.plan as RunPlan;
    const item = plan.items.find((i) => i.id === attempt.runExerciseId);
    if (!item) throw notFound();
    const hint = hintOf(attempt.result as { hint?: { expected: string; got: string } });

    // Кеш: одинаковые (упражнение, класс ошибки) у всех получают один ответ — без повторного вызова GigaChat.
    if (item.exerciseId) {
      const [cached] = await this.db
        .select({ text: aiExplanations.text })
        .from(aiExplanations)
        .where(sql`${aiExplanations.exerciseId} = ${item.exerciseId} AND ${aiExplanations.errorClass} = ${verdict}`);
      if (cached) return { text: cached.text, source: "ai" };
    }

    const context = principal.kind === "child" ? null : gatewayContext(item, attempt.answer, verdict, hint);
    if (context && item.exerciseId) {
      const ai = await this.callGateway(context);
      if (ai) {
        await this.db
          .insert(aiExplanations)
          .values({ exerciseId: item.exerciseId, errorClass: verdict, text: ai })
          .onConflictDoNothing();
        return { text: ai, source: "ai" };
      }
    }
    return { text: templateExplanation(verdict, hint), source: "template" };
  }

  /** Вызов шлюза: таймаут и любой сбой — null, деградация к шаблону без ошибки для пользователя (docs/04 §2.5). */
  private async callGateway(context: GatewayContext): Promise<string | null> {
    try {
      const res = await fetch(`${this.config.AI_GATEWAY_URL}/v1/explain-error`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.config.AI_GATEWAY_TOKEN ? { Authorization: `Bearer ${this.config.AI_GATEWAY_TOKEN}` } : {}),
        },
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { text?: unknown };
      return typeof body.text === "string" && body.text.length >= 1 && body.text.length <= 400 ? body.text : null;
    } catch {
      return null;
    }
  }
}

function hintOf(result: { hint?: { expected: string; got: string } }): { expected: string; got: string } | undefined {
  const h = result?.hint;
  return h && typeof h.expected === "string" && typeof h.got === "string" ? { expected: h.expected, got: h.got } : undefined;
}
