// Выгрузка словаря и спорных случаев для Фонда (ADR 0023): CSV для Excel и JSON — те же данные,
// что GET /fund/dictionary и GET /fund/escalated. Чистые функции без запросов; голосующих в выгрузке нет — только
// числа по группам.
import type { Schema } from "@teletau/contracts";
import { csvTable } from "@teletau/ui/files";

type Dictionary = Schema<"FundDictionary">;
type Pair = Schema<"FundPair">;
type Votes = Schema<"FundGroupVotes">;
type Escalated = Schema<"FundEscalated">;
type EscVariant = Schema<"EscalatedVariant">;

const ORIGIN: Record<string, string> = { import: "из источника", human: "от участника", mt: "машинный перевод", llm: "языковая модель" };
const KIND: Record<string, string> = { word: "слово", phrase: "словосочетание", sentence: "предложение", term: "термин" };
const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Yekaterinburg" });

export const originLabel = (o: string | undefined) => (o ? (ORIGIN[o] ?? o) : "");
export const kindLabel = (k: string) => KIND[k] ?? k;
export const decisionDate = (iso: string) => dateFmt.format(new Date(iso));
const statusLabel = (p: Pair) => (p.preliminary ? "предварительно" : "принято");
/** Проверка носителем — словами: пара словаря или вариант спора. */
const reviewLabel = (review: string | undefined) =>
  review === "native_approved" ? "проверено носителем" : review === "native_rejected" ? "отклонено носителем" : "ждёт проверки носителем";

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
      reviewLabel(p.review),
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

/** JSON: ответ API как есть и пояснение к флагу `preliminary` — без терминов разработки. */
export function dictionaryJson(d: Dictionary): string {
  const note =
    "Пояснение к полю preliminary: true — пара принята по упрощённым правилам голосования и может уточниться после запуска полной проверки экспертами. В финальные выпуски словаря такие пары не входят.";
  return `${JSON.stringify({ note, ...d }, null, 2)}\n`;
}


/** Спорные случаи для Excel: строка на вариант спора; голоса — «за вариант», «оба подходят», «всего» по каждой группе. */
export function escalatedCsv(e: Escalated): string {
  const head = [
    "Русский исходник",
    "Башкирский вариант",
    "Вид",
    "Проверка носителем",
    "Происхождение варианта",
    "Дети: за вариант",
    "Дети: оба подходят",
    "Дети: всего голосов",
    "Взрослые: за вариант",
    "Взрослые: оба подходят",
    "Взрослые: всего голосов",
    "Учителя: за вариант",
    "Учителя: оба подходят",
    "Учителя: всего голосов",
    "Последний голос",
    "id исходника",
    "id варианта",
  ];
  const rows = e.items.flatMap((item) =>
    item.variants.map((v: EscVariant) => [
      item.sourceRu,
      v.text,
      kindLabel(item.kind),
      reviewLabel(v.review),
      originLabel(v.origin),
      ...group(v.votes.child),
      ...group(v.votes.adult),
      ...group(v.votes.teacher),
      decisionDate(item.lastVoteAt),
      item.itemId,
      v.variantId,
    ]),
  );
  return csvTable([head, ...rows]);
}

/** JSON: ответ API как есть и пояснение, что это за список и что с ним делают. */
export function escalatedJson(e: Escalated): string {
  const note =
    "Пояснение: спорные случаи — пары, в которых голоса групп участников разошлись, и упрощённые правила голосования не выбрали лучший вариант. Такие пары передаются носителям языка на экспертизу; после решения они появятся в словаре.";
  return `${JSON.stringify({ note, ...e }, null, 2)}\n`;
}

/** Имя файла выгрузки: «teletau-slovar-fond-2026-11-05.csv» / «teletau-spory-fond-2026-11-05.json» (дата по Уфе). */
export function exportFileName(d: { generatedAt: string }, kind: "dictionary" | "escalated", ext: "csv" | "json"): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg" }).format(new Date(d.generatedAt));
  return `teletau-${kind === "dictionary" ? "slovar" : "spory"}-fond-${day}.${ext}`;
}
