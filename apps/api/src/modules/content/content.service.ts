import { Inject, Injectable } from "@nestjs/common";
import type { NodeKind } from "@teletau/domain-rules";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { unavailable } from "../../common/problem.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import type { AnswerKey, AudioClip, BaString, ContentApi, CourseContent, ExerciseContent, LessonContent, Lexicon, NodeContent, SourceCitation, UnitContent } from "./content.api.js";
import { wordKey } from "./content-import.js";
import { contentVersions, exercises, lessons, units, words } from "./content.schema.js";

type NodeIcon = NonNullable<NodeContent["icon"]>;
const ICONS: ReadonlySet<string> = new Set<NodeIcon>(["star", "chat-circle-text", "book-open", "barbell"]);

/** Ключ ответа в базе (content-import.ts): meaningRu лежит рядом с ключом — это толкование для листа обратной связи. */
type StoredKey = AnswerKey & { meaningRu?: string };

/** Башкирские строки упражнения, которые оно проверяет (лишние плитки — нет): по ним слово получает оценку в повторении. */
function testedTexts(type: ExerciseContent["type"], payload: Record<string, unknown>, key: AnswerKey): string[] {
  if (key.kind === "accepted") return key.accepted.map((a) => a.text);
  if (type === "choice_ba_ru") return [(payload["prompt"] as BaString | undefined)?.text ?? ""];
  if (type === "match_pairs") return ((payload["pairs"] as { ba: BaString }[] | undefined) ?? []).map((p) => p.ba.text);
  return [];
}

/**
 * Курс из импортированного YAML (таблицы content.schema.ts, импорт — content-import.ts). Курс пока один: берётся
 * курс последней загруженной версии. Ключи ответов отдаются только другим модулям сервера (learning), не клиентам.
 */
@Injectable()
export class ContentService implements ContentApi {
  constructor(@Inject(DB) protected readonly db: Db) {}

  /** Курс последней загруженной версии (курс пока один). */
  private async current(): Promise<{ courseId: string; version: number }> {
    const [current] = await this.db
      .select({ courseId: contentVersions.courseId, version: contentVersions.version })
      .from(contentVersions)
      .orderBy(desc(contentVersions.importedAt), desc(contentVersions.version))
      .limit(1);
    if (!current) throw unavailable("content_unavailable");
    return current;
  }

  async course(): Promise<CourseContent> {
    const current = await this.current();
    const unitRows = await this.db.select().from(units).where(eq(units.courseId, current.courseId)).orderBy(asc(units.position));
    if (unitRows.length === 0) throw unavailable("content_unavailable");
    const unitIds = unitRows.map((u) => u.id);
    const [nodeRows, counts] = await Promise.all([
      this.db.select().from(lessons).where(inArray(lessons.unitId, unitIds)).orderBy(asc(lessons.unitId), asc(lessons.position)),
      this.db
        .select({ lessonId: exercises.lessonId, n: count(), graded: sql<number>`count(*) FILTER (WHERE ${exercises.type} <> 'duel')::int` })
        .from(exercises)
        .innerJoin(lessons, eq(lessons.id, exercises.lessonId))
        .where(inArray(lessons.unitId, unitIds))
        .groupBy(exercises.lessonId),
    ]);
    const exerciseCount = new Map(counts.map((c) => [c.lessonId, c.n]));
    const gradedCount = new Map(counts.map((c) => [c.lessonId, c.graded]));
    const out: UnitContent[] = unitRows.map((u) => ({
      id: u.id,
      position: u.position,
      status: u.status,
      place: {
        slug: u.placeSlug,
        titleRu: u.titleRu,
        ...(u.titleBa && u.titleBaReview && u.titleBaReview !== "native_rejected" ? { titleBa: { text: u.titleBa, review: u.titleBaReview } } : {}),
      },
      topicRu: u.topicRu,
      nodes: nodeRows
        .filter((n) => n.unitId === u.id)
        .sort((a, b) => a.position - b.position)
        .map((n) => this.node(n, n.kind === "help_language" ? (n.duelCount ?? 0) : (exerciseCount.get(n.id) ?? 0), gradedCount.get(n.id) ?? 0)),
    }));
    return { id: current.courseId, contentVersion: current.version, units: out };
  }

  async lesson(lessonId: string): Promise<LessonContent | undefined> {
    const [row] = await this.db.select({ lesson: lessons, courseId: units.courseId }).from(lessons).innerJoin(units, eq(units.id, lessons.unitId)).where(eq(lessons.id, lessonId));
    if (!row) return undefined;
    const lesson = row.lesson;
    const rows = await this.db.select().from(exercises).where(eq(exercises.lessonId, lessonId)).orderBy(asc(exercises.position));
    // Слова урока — new_words, которые есть в словаре курса (у слова есть перевод).
    const newWords = lesson.newWords as BaString[];
    const keys = [...new Set(newWords.map((w) => wordKey(w.text)).filter(Boolean))];
    const known =
      keys.length === 0
        ? new Set<string>()
        : new Set((await this.db.select({ id: words.id }).from(words).where(and(eq(words.courseId, row.courseId), inArray(words.id, keys)))).map((w) => w.id));
    const wordIds = keys.filter((k) => known.has(k));
    const items: ExerciseContent[] = rows.map((e) => {
      const { meaningRu, ...answerKey } = (e.answerKey ?? { kind: "none" }) as StoredKey;
      const tested = [...new Set(testedTexts(e.type, e.payload as Record<string, unknown>, answerKey as AnswerKey).map(wordKey))].filter((k) => known.has(k));
      return {
        id: e.id,
        position: e.position,
        type: e.type,
        payload: e.payload as Record<string, unknown>,
        answerKey: answerKey as AnswerKey,
        review: e.review === "native_approved" ? "native_approved" : "needs_native_review",
        sources: e.sources as SourceCitation[],
        ...(e.duelRef ? { duelRef: e.duelRef } : {}),
        ...(meaningRu ? { meaningRu } : {}),
        words: tested,
      };
    });
    return {
      ...this.node(lesson, lesson.kind === "help_language" ? (lesson.duelCount ?? 0) : items.length, items.filter((e) => e.type !== "duel").length),
      newWords,
      wordIds,
      exercises: items,
      contentVersion: lesson.contentVersion,
    };
  }

  async words(): Promise<Lexicon> {
    const current = await this.current();
    const rows = await this.db.select().from(words).where(eq(words.courseId, current.courseId)).orderBy(asc(words.position));
    const list = rows.map((w) => {
      const audio = w.audio as AudioClip | null;
      return {
        id: w.id,
        position: w.position,
        word: { text: w.text, review: w.review === "native_approved" ? ("native_approved" as const) : ("needs_native_review" as const), ...(audio ? { audio } : {}) },
        translationRu: w.translationRu,
        sources: w.sources as SourceCitation[],
        lessonId: w.lessonId,
      };
    });
    return { courseId: current.courseId, contentVersion: current.version, words: list };
  }

  private node(n: typeof lessons.$inferSelect, exerciseCount: number, gradedCount: number): NodeContent {
    return {
      id: n.id,
      unitId: n.unitId,
      position: n.position,
      kind: n.kind satisfies NodeKind,
      titleRu: n.titleRu,
      ...(n.icon && ICONS.has(n.icon) ? { icon: n.icon as NodeIcon } : {}),
      exerciseCount,
      gradedCount,
    };
  }
}
