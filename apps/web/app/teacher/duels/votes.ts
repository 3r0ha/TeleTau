// «Помогите языку» для учителя — данные listCorpusDuels, submitCorpusJudgment, getCorpusItemVotes (contracts/openapi.yaml).
// Голоса считаются раздельно по группам — дети, взрослые, учителя (docs/03 §4a); статус — по правилам duel-v0 (ADR 0019)
// считает сервер, здесь только подписи и раскладка голосов в порядке показа вариантов (A, B).
import type { Schema } from "@teletau/contracts";
import { plural } from "../../_components/learn/format";

export type CorpusDuel = Schema<"CorpusDuel">;
export type CorpusItemVotes = Schema<"CorpusItemVotes">;
export type GroupTally = Schema<"GroupTally">;
export type ItemStatus = Schema<"ItemStatus">;
export type DuelChoice = Schema<"DuelChoice">;
type Group = keyof Schema<"GroupTallies">;

/** Порядок групп на экране — как в сценарии показа: дети / взрослые / учителя. */
export const GROUPS: { key: Group; label: string }[] = [
  { key: "child", label: "Дети" },
  { key: "adult", label: "Взрослые" },
  { key: "teacher", label: "Учителя" },
];

export type SegmentKey = "a" | "b" | "both" | "skip";

export interface Segment {
  key: SegmentKey;
  /** Подпись в строке счёта: «A», «B», «оба», «не знаю». */
  label: string;
  /** Полная подпись для подсказки и читалки. */
  long: string;
  count: number;
}

/** Голоса группы в порядке показа: A и B — варианты дуэли (shown[0], shown[1]), затем «Оба подходят» и «Не знаю». */
export function segmentsOf(tally: GroupTally, shown: readonly [string, string]): Segment[] {
  const votes = (id: string) => tally.variants.find((v) => v.variantId === id)?.votes ?? 0;
  return [
    { key: "a", label: "A", long: "вариант A", count: votes(shown[0]) },
    { key: "b", label: "B", long: "вариант B", count: votes(shown[1]) },
    { key: "both", label: "оба", long: "оба подходят", count: tally.both },
    { key: "skip", label: "не знаю", long: "не знаю", count: tally.skip },
  ];
}

export interface BarPiece {
  key: SegmentKey;
  /** Начало и ширина в процентах от длины полосы. */
  x: number;
  width: number;
  count: number;
}

/** Куски полосы группы: доли голосов, без пустых кусков; голосов нет — пустой список. */
export function barPieces(segments: readonly Segment[]): BarPiece[] {
  const total = segments.reduce((s, x) => s + x.count, 0);
  if (!total) return [];
  let x = 0;
  const out: BarPiece[] = [];
  for (const s of segments) {
    if (!s.count) continue;
    const width = (s.count / total) * 100;
    out.push({ key: s.key, x: round2(x), width: round2(width), count: s.count });
    x += width;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const votesWord = (n: number) => plural(n, ["голос", "голоса", "голосов"]);
export const pairsWord = (n: number) => plural(n, ["пару", "пары", "пар"]);

/** Статус пары словами продукта — без названий правил и ролей проверки. */
export const STATUS_LABEL: Record<ItemStatus, string> = {
  voting: "Ещё собираем голоса",
  accepted: "Пару приняли",
  escalated: "Мнения разошлись",
};

/** Буква варианта в порядке показа. */
export function letterOf(variantId: string, shown: readonly [string, string]): "A" | "B" | null {
  if (variantId === shown[0]) return "A";
  if (variantId === shown[1]) return "B";
  return null;
}

/** Пояснение к статусу — одной фразой, на «вы», без правил подсчёта. */
export function statusText(votes: CorpusItemVotes, shown: readonly [string, string]): string {
  if (votes.status === "voting") return "Итог появится, когда проголосуют другие.";
  if (votes.status === "escalated") return "Голоса разделились — пару посмотрят ещё раз.";
  const main = votes.variants.find((v) => v.main) ?? votes.variants.find((v) => v.accepted);
  const letter = main ? letterOf(main.variantId, shown) : null;
  return letter ? `Вариант ${letter} вошёл в словарь.` : "Перевод вошёл в словарь.";
}

/** Выбор из голоса для подписи «Ваш голос»: «A», «B», «оба подходят», «не знаю». */
export function choiceLabel(choice: DuelChoice): string {
  return choice === "a" ? "A" : choice === "b" ? "B" : choice === "both" ? "оба подходят" : "не знаю";
}
