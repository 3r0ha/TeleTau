// Демо-корпус пары ba-kz («башкирский ← казахский», запрос владельца «ru-ba, kz-ba»): 50 казахско-башкирских пар —
// приветствие и вежливость, семья, числа, быт, тело и природа. Казахское слово — в канонической записи, башкирский
// эквивалент (первый вариант) — точный: пары — сравнимые слова тюркской семьи (ана/инә, су/һыу, жеті/ете …).
// Второй вариант — правдоподобная альтернатива дуэли: голосование принимает первый (как принимаются пары ba-ru).
// Источник всех строк — «Демо-корпус ТелеТау»: словарь для демонстрации, а не засвидетельствованные переводы
// (правило 6); в тестах строки синтетические. Файлы корпуса пишет writeKzCorpus, грузит их importDuels (lang = kz).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, toComparable } from "@teletau/bashkir-text";

/** Юнит корпуса в source_items.unit_id: вне юнитов курса — в дуэли уроков эти пары не попадают. */
export const KZ_UNIT = "kz-demo";

/** Источник строк корпуса (реестр для sources.yaml импорта). */
export const KZ_SOURCE = { id: "teletau-demo-kz", title: "Демо-корпус ТелеТау", license: "CC0", url: "https://demo.teletau.local/kz" } as const;

export interface KzPair {
  /** Казахский исходник. */
  kz: string;
  /** Башкирский эквивалент — его голосование принимает (основной вариант). */
  ba: string;
  /** Альтернатива дуэли: правдоподобный, но не основной башкирский вариант. */
  alt: string;
  kind: "word" | "phrase";
  domain: string;
}

/** 50 пар: приветствие (6), семья (9), числа (11), быт (13), тело и природа (11). */
export const KZ_PAIRS: KzPair[] = [
  // приветствие и вежливость
  { kz: "Сәлем", ba: "Сәләм", alt: "Һаумы", kind: "word", domain: "greeting" },
  { kz: "Сәлеметсіз бе", ba: "Һаумыһығыҙ", alt: "Иҫәнмеһегеҙ", kind: "phrase", domain: "greeting" },
  { kz: "Қалыңыз қалай?", ba: "Хәлдәрегеҙ нисек?", alt: "Яҡшымы һеҙ?", kind: "phrase", domain: "greeting" },
  { kz: "Рахмет", ba: "Рәхмәт", alt: "Шөкөр", kind: "word", domain: "greeting" },
  { kz: "Сау болыңыз", ba: "Һау булыгыҙ", alt: "Хуш ҡалығыҙ", kind: "phrase", domain: "greeting" },
  { kz: "Жоқ, рахмет", ba: "Юҡ, рәхмәт", alt: "Юҡ, кәрәкмәй", kind: "phrase", domain: "greeting" },
  // семья
  { kz: "ана", ba: "инә", alt: "әсәй", kind: "word", domain: "family" },
  { kz: "әке", ba: "ата", alt: "атай", kind: "word", domain: "family" },
  { kz: "бала", ba: "бала", alt: "сабый", kind: "word", domain: "family" },
  { kz: "аға", ba: "ағай", alt: "туған", kind: "word", domain: "family" },
  { kz: "әпке", ba: "апай", alt: "һеңле", kind: "word", domain: "family" },
  { kz: "іні", ba: "эне", alt: "ҡусты", kind: "word", domain: "family" },
  { kz: "қарындас", ba: "һеңле", alt: "туған", kind: "word", domain: "family" },
  { kz: "әже", ba: "өләсәй", alt: "әбей", kind: "word", domain: "family" },
  { kz: "ата", ba: "олатай", alt: "бабай", kind: "word", domain: "family" },
  // числа
  { kz: "бір", ba: "бер", alt: "берәү", kind: "word", domain: "numbers" },
  { kz: "екі", ba: "ике", alt: "икәү", kind: "word", domain: "numbers" },
  { kz: "үш", ba: "өс", alt: "өсәү", kind: "word", domain: "numbers" },
  { kz: "төрт", ba: "дүрт", alt: "дүртәү", kind: "word", domain: "numbers" },
  { kz: "бес", ba: "биш", alt: "бишәү", kind: "word", domain: "numbers" },
  { kz: "жеті", ba: "ете", alt: "алты", kind: "word", domain: "numbers" },
  { kz: "сегіз", ba: "һигеҙ", alt: "туғыҙ", kind: "word", domain: "numbers" },
  { kz: "тоғыз", ba: "туғыҙ", alt: "һигеҙ", kind: "word", domain: "numbers" },
  { kz: "он", ba: "ун", alt: "туғыҙ", kind: "word", domain: "numbers" },
  { kz: "жүз", ba: "йөҙ", alt: "ун", kind: "word", domain: "numbers" },
  { kz: "мың", ba: "мең", alt: "йөҙ", kind: "word", domain: "numbers" },
  // быт: дом и еда
  { kz: "су", ba: "һыу", alt: "ҡойо", kind: "word", domain: "household" },
  { kz: "нан", ba: "икмәк", alt: "бауырһаҡ", kind: "word", domain: "household" },
  { kz: "тұз", ba: "тоҙ", alt: "тоҙло", kind: "word", domain: "household" },
  { kz: "сүт", ba: "һөт", alt: "ҡымыҙ", kind: "word", domain: "household" },
  { kz: "ет", ba: "ит", alt: "итле", kind: "word", domain: "household" },
  { kz: "шай", ba: "сәй", alt: "ҡымыҙ", kind: "word", domain: "household" },
  { kz: "бал", ba: "бал", alt: "шәкәр", kind: "word", domain: "household" },
  { kz: "қант", ba: "шәкәр", alt: "бал", kind: "word", domain: "household" },
  { kz: "үй", ba: "өй", alt: "торлаҡ", kind: "word", domain: "household" },
  { kz: "есік", ba: "ишек", alt: "ҡапҡа", kind: "word", domain: "household" },
  { kz: "терезе", ba: "тәҙрә", alt: "ишек", kind: "word", domain: "household" },
  { kz: "үстел", ba: "өҫтәл", alt: "ултырғыс", kind: "word", domain: "household" },
  { kz: "орындық", ba: "ултырғыс", alt: "өҫтәл", kind: "word", domain: "household" },
  // тело и природа
  { kz: "күз", ba: "күҙ", alt: "ҡолаҡ", kind: "word", domain: "nature" },
  { kz: "ауыз", ba: "ауыҙ", alt: "теш", kind: "word", domain: "nature" },
  { kz: "қол", ba: "ҡул", alt: "бармаҡ", kind: "word", domain: "nature" },
  { kz: "күн", ba: "көн", alt: "төн", kind: "word", domain: "nature" },
  { kz: "түн", ba: "төн", alt: "көн", kind: "word", domain: "nature" },
  { kz: "жұлдыз", ba: "йондоҙ", alt: "ай", kind: "word", domain: "nature" },
  { kz: "өзен", ba: "йылға", alt: "ҡойо", kind: "word", domain: "nature" },
  { kz: "көл", ba: "күл", alt: "шишмә", kind: "word", domain: "nature" },
  { kz: "орман", ba: "урман", alt: "ҡарағай", kind: "word", domain: "nature" },
  { kz: "ағаш", ba: "ағас", alt: "япраҡ", kind: "word", domain: "nature" },
  { kz: "гүл", ba: "сәскә", alt: "үлән", kind: "word", domain: "nature" },
];

/** Внешний id дуэли корпуса: kz-d01 … kz-d50. */
export const kzExternalId = (n: number): string => `kz-d${String(n + 1).padStart(2, "0")}`;

/**
 * Записывает файлы корпуса в `dir` (sources.yaml и kz-demo.yaml) для importDuels: казахский исходник — в поле ru
 * (текст исходника любой пары), башкирские варианты — в канонической форме normalize() (правило 7). Альтернатива
 * обязана отличаться от эквивалента — иначе это не дуэль (проверяет и импорт).
 */
export function writeKzCorpus(dir: string): { duelsDir: string; sourcesFile: string } {
  // Казахский исходник пишется как есть (normalize — только для башкирского: он сворачивает двойники кириллицы,
  // например казахское Қ в башкирское Ҡ, и исказил бы казахский текст).
  const kz = (s: string) => JSON.stringify(s);
  const ba = (s: string) => JSON.stringify(normalize(s));
  const variant = (text: string, pair: KzPair, n: number, i: number) =>
    `      - ba: ${ba(text)}\n        source:\n          ref: ${KZ_SOURCE.id}\n          url: ${KZ_SOURCE.url}\n          locator: пара №${String(n + 1).padStart(2, "0")} «${pair.kz} — ${normalize(pair.ba)}», вариант ${i + 1}\n        review: needs_native_review`;
  const duels = KZ_PAIRS.map((p, n) => {
    if (toComparable(p.ba) === toComparable(p.alt)) throw new Error(`kz-корпус: пара №${n + 1} — варианты совпадают, это не дуэль`);
    return `  - id: ${kzExternalId(n)}\n    ru: ${kz(p.kz)}\n    kind: ${p.kind}\n    domain: ${p.domain}\n    variants:\n${variant(p.ba, p, n, 0)}\n${variant(p.alt, p, n, 1)}`;
  }).join("\n");
  const sources = `sources:\n  - id: ${KZ_SOURCE.id}\n    title: ${JSON.stringify(KZ_SOURCE.title)}\n    url: ${KZ_SOURCE.url}\n    license: ${KZ_SOURCE.license}\n    accessed: "2026-11-14"\n`;
  writeFileSync(join(dir, "sources.yaml"), sources);
  const duelsDir = join(dir, "duels");
  mkdirSync(duelsDir, { recursive: true });
  writeFileSync(join(duelsDir, "kz-demo.yaml"), `# Демо-корпус ТелеТау — пара ba-kz (башкирский ← казахский): казахский исходник и два башкирских варианта.\nunit: ${KZ_UNIT}\nduels:\n${duels}\n`);
  return { duelsDir, sourcesFile: join(dir, "sources.yaml") };
}
