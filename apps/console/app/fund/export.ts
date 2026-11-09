// Выгрузка словаря для Фонда (ADR 0023): CSV для Excel и JSON — те же данные, что GET /fund/dictionary.
// Чистые функции без запросов; голосующих в выгрузке нет — только числа по группам.
import type { Schema } from "@teletau/contracts";
import { csvTable } from "@teletau/ui/files";

type Dictionary = Schema<"FundDictionary">;
type Pair = Schema<"FundPair">;
type Votes = Schema<"FundGroupVotes">;

const ORIGIN: Record<string, string> = { import: "из источника", human: "от участника", mt: "машинный перевод", llm: "языковая модель" };
const KIND: Record<string, string> = { word: "слово", phrase: "словосочетание", sentence: "предложение", term: "термин" };
const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Yekaterinburg" });

export const originLabel = (o: string) => ORIGIN[o] ?? o;
export const kindLabel = (k: string) => KIND[k] ?? k;
export const decisionDate = (iso: string) => dateFmt.format(new Date(iso));
export const statusLabel = (p: Pair) => (p.preliminary ? "предварительно" : "принято");
export const reviewLabel = (p: Pair) => (p.review === "native_approved" ? "проверено носителем" : "ждёт проверки носителем");

const group = (v: Votes) => [v.votesFor, v.both, v.total];

/** Таблица для Excel: строка на принятый вариант; голоса — «за вариант», «оба подходят», «всего» по каждой группе. */
export function dictionaryCsv(d: Dictionary): string {
  const head = [
    "Русский исходник",
    "Башкирский вариант",
    "Вид",
    "Основной вариант",
    "Статус",
    "Проверка носителем",
    "Дети: за вариант",
    "Дети: оба подходят",
    "Дети: всего голосов",
    "Взрослые: за вариант",
    "Взрослые: оба подходят",
    "Взрослые: всего голосов",
    "Учителя: за вариант",
    "Учителя: оба подходят",
    "Учителя: всего голосов",
    "Дата решения",
    "Кто решил",
    "Правила",
    "Происхождение варианта",
    "Источник",
    "Ссылка",
    "Место в источнике",
    "Лицензия",
    "id исходника",
    "id варианта",
  ];
  const rows = d.items.map((p) => {
    const src = p.sources[0];
    return [
      p.sourceRu,
      p.textBa,
      kindLabel(p.kind),
      p.main ? "да" : "нет",
      statusLabel(p),
      reviewLabel(p),
      ...group(p.votes.child),
      ...group(p.votes.adult),
      ...group(p.votes.teacher),
      decisionDate(p.decidedAt),
      p.decidedBy === "expert" ? "эксперт" : "голосование",
      p.rulesVersion,
      originLabel(p.origin),
      src?.title,
      src?.url,
      src?.locator,
      src?.license,
      p.itemId,
      p.variantId,
    ];
  });
  return csvTable([head, ...rows]);
}

/** JSON: ответ API как есть и пояснение к флагу `preliminary`. */
export function dictionaryJson(d: Dictionary): string {
  const note =
    "preliminary = true: пара принята по правилам голосования duel-v0 (ADR 0019); до Consensus Engine (веха M4) она не входит в релиз датасета и может измениться при пересчёте.";
  return `${JSON.stringify({ note, ...d }, null, 2)}\n`;
}

/** Имя файла: «teletau-slovar-fond-2026-11-05.csv» (дата выгрузки по Уфе). */
export function exportFileName(d: Dictionary, ext: "csv" | "json"): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg" }).format(new Date(d.generatedAt));
  return `teletau-slovar-fond-${day}.${ext}`;
}
