// Библиотека атомов: каждая башкирская строка берётся ТОЛЬКО через функцию, которая проверяет,
// что текст посимвольно есть в сохранённой копии источника. Иначе — исключение.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize } from "../../../packages/bashkir-text/dist/index.js";

const S = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(S, p), "utf8");
const enc = (s) => encodeURIComponent(s);

const WV = read("cache/wv-ru.txt").split("\n");
const WV_REV = 761421;
const ETIKET = read("cache/ba-etiket.txt");
const ETIKET_REV = 1051009;
const TATOEBA = new Map(JSON.parse(read("cache/tatoeba-bak.json")).map((s) => [s.id, s]));
/** Сохранённые ответы Datasets Viewer /filter: row_idx → { ba, ru, corpus }. */
let HF;
const hfRows = () => {
  if (HF) return HF;
  HF = new Map();
  for (const f of ["cache/hf/exact.json", "cache/hf/quick.json"]) {
    const p = join(S, f);
    if (!existsSync(p)) continue;
    for (const v of Object.values(JSON.parse(readFileSync(p, "utf8")))) for (const r of v.rows ?? []) HF.set(r.row_idx, r);
  }
  return HF;
};

const fail = (m) => {
  throw new Error(m);
};

/** BaText из текста источника (raw) → { ba, raw?, ru?, source, review }. */
function baText(text, ru, source) {
  const ba = normalize(text);
  const o = { ba };
  if (ba !== text) o.raw = text;
  if (ru) o.ru = ru;
  o.source = source;
  o.review = "needs_native_review";
  return o;
}

/** Русская часть строки Викигида «; ruHead : перевод» (без пробелов по краям). */
const wvHead = (l) => (l.startsWith(";") && l.includes(":") ? l.slice(1, l.indexOf(":")).trim() : undefined);

function wvSection(lineNo) {
  for (let i = lineNo; i >= 0; i--) {
    const m = WV[i].match(/^(=+)\s*([^=]+?)\s*=+\s*$/);
    if (m && m[1].length >= 3) return m[2];
  }
  return "?";
}

/**
 * Викигид, «Башкирский разговорник». ruHead — русская фраза в начале строки «; ruHead : …».
 * alt: true — текст взят из варианта в скобках ('' … '').
 */
export function wv(text, ruHead, { ru = ruHead, alt = false } = {}) {
  const idx = WV.findIndex((l) => wvHead(l) === ruHead);
  if (idx < 0) fail(`wv: нет строки «${ruHead}»`);
  const line = WV[idx];
  const body = line.slice(line.indexOf(":") + 1);
  const [main, paren = ""] = [body.split("(''")[0], (body.match(/\(''(.*?)''/) ?? [])[1] ?? ""];
  if (!(alt ? paren : main).includes(text)) fail(`wv: «${text}» нет в ${alt ? "варианте в скобках" : "основном переводе"} строки ${idx + 1}: ${line}`);
  const section = wvSection(idx);
  return baText(text, ru, {
    ref: "wikivoyage-ru-bashkir-phrasebook",
    url: `https://ru.wikivoyage.org/w/index.php?title=${enc("Башкирский_разговорник")}&oldid=${WV_REV}`,
    locator: `раздел «${section}», строка «${ruHead.replace(/''/g, "")}»${alt ? ", вариант в скобках" : ""}`,
  });
}

/** Викигид, раздел «Словарь»: строка «;термин (вариант)»; ru — должно встречаться в описании на следующей строке. */
export function wvDict(text, ru) {
  const start = WV.findIndex((l) => /^==\s*Словарь\s*==/.test(l));
  const idx = WV.findIndex((l, i) => i > start && l.startsWith(";") && l.slice(1).includes(text));
  if (start < 0 || idx < 0) fail(`wvDict: «${text}» нет в разделе «Словарь»`);
  if (ru && !(WV[idx + 1] ?? "").startsWith(":")) fail(`wvDict: у «${text}» нет описания`);
  if (ru && !WV[idx + 1].includes(ru)) fail(`wvDict: в описании «${text}» нет «${ru}»`);
  return baText(text, ru, {
    ref: "wikivoyage-ru-bashkir-phrasebook",
    url: `https://ru.wikivoyage.org/w/index.php?title=${enc("Башкирский_разговорник")}&oldid=${WV_REV}`,
    locator: `раздел «Словарь», статья «${WV[idx].slice(1).trim()}»`,
  });
}

/** Tatoeba: текст — ровно текст предложения; ru — одна из его русских переводов (прямых или через другой язык). */
export function tat(id, text, ru) {
  const s = TATOEBA.get(id) ?? fail(`tatoeba: нет предложения ${id}`);
  if (s.text !== text) fail(`tatoeba ${id}: «${s.text}» ≠ «${text}»`);
  const direct = s.direct.find((t) => t.text === ru);
  const indirect = s.indirect.find((t) => t.text === ru);
  if (!direct && !indirect) fail(`tatoeba ${id}: перевода «${ru}» нет (${[...s.direct, ...s.indirect].map((t) => t.text).join(" / ")})`);
  const t = direct ?? indirect;
  return baText(text, ru, {
    ref: "tatoeba",
    url: `https://tatoeba.org/ru/sentences/show/${id}`,
    locator: `предложение №${id} (${s.license}); русский перевод №${t.id}${direct ? "" : " — связан косвенно, через перевод на другой язык"}`,
  });
}

/** Корпус AigizK: пара из ответа Datasets Viewer /filter (row_idx — номер строки по API) с ровно таким ba и ru. */
export function hf(i, text, ru) {
  const r = hfRows().get(i) ?? fail(`hf: строки ${i} нет в сохранённых ответах /filter`);
  if (r.ba !== text) fail(`hf ${i}: ba «${r.ba}» ≠ «${text}»`);
  if (r.ru !== ru) fail(`hf ${i}: ru «${r.ru}» ≠ «${ru}»`);
  const where = `"ba"='${text.replaceAll("'", "''")}' AND "ru"='${ru.replaceAll("'", "''")}'`;
  return baText(text, ru, {
    ref: "aigizk-bashkir-russian-corpora",
    url: `https://datasets-server.huggingface.co/filter?dataset=${enc("AigizK/bashkir-russian-parallel-corpora")}&config=default&split=train&where=${enc(where)}`,
    locator: `Datasets Viewer /filter, row_idx ${i}; поле corpus: «${r.corpus}»`,
  });
}

/** Русский Викисловарь, башкирская статья word: текст встречается в её разделе «Башкирский». */
export function wkt(word, text, ru, where) {
  const s = read(`cache/wiktba/${word}.txt`);
  const i = s.search(/\{\{-ba-\}\}/);
  if (i < 0) fail(`wkt ${word}: нет раздела ba`);
  let sec = s.slice(i);
  const j = sec.slice(10).search(/\n= *\{\{-[a-z-]+-\}\} *=/);
  if (j > 0) sec = sec.slice(0, j + 10);
  const plain = sec.replace(/\{\{выдел\|([^}]*)\}\}/g, "$1").replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, "$1");
  // Заголовок статьи (text === word) засвидетельствован самим названием страницы с башкирским разделом.
  if (text !== word && !plain.includes(text)) fail(`wkt ${word}: «${text}» нет в разделе ba`);
  // Русское толкование сравнивается без учёта вида пробела (в Викисловаре перед тире бывает U+00A0).
  if (ru && !plain.replace(/\u00a0/g, " ").includes(ru.replace(/[.!?]$/, ""))) fail(`wkt ${word}: толкования «${ru}» нет`);
  return baText(text, ru, {
    ref: "wiktionary-ru",
    url: `https://ru.wiktionary.org/wiki/${enc(word)}`,
    locator: `статья «${word}», раздел «Башкирский», ${where}`,
  });
}

/** Русский Викисловарь, башкирская статья word: syn — в разделе «Синонимы» к значению sense (номер строки). ru — толкование этого значения. */
export function wktsyn(word, syn, sense, ru) {
  const s = read(`cache/wiktba/${word}.txt`);
  const i = s.search(/\{\{-ba-\}\}/);
  if (i < 0) fail(`wktsyn ${word}: нет раздела ba`);
  const m = s.slice(i).match(/==== Синонимы ====\n([\s\S]*?)\n(?:====|===|\{\{)/) ?? fail(`wktsyn ${word}: нет синонимов`);
  const line = m[1].split("\n")[sense - 1] ?? "";
  if (!line.includes(`[[${syn}]]`)) fail(`wktsyn ${word}: «${syn}» нет в синонимах к значению ${sense}: ${line}`);
  const gloss = s.slice(i).match(/==== Значение ====\n([\s\S]*?)\n====/)?.[1].split("\n")[sense - 1] ?? "";
  if (!gloss.replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, "$1").includes(ru)) fail(`wktsyn ${word}: значение ${sense} — не «${ru}»: ${gloss.slice(0, 80)}`);
  return baText(syn, ru, {
    ref: "wiktionary-ru",
    url: `https://ru.wiktionary.org/wiki/${enc(word)}`,
    locator: `статья «${word}», раздел «Башкирский», синоним к значению ${sense}`,
  });
}

/** Русский Викисловарь, русская статья ruWord: башкирский перевод в таблице «Перевод» (|ba=…). */
export function wktru(ruWord, text) {
  const s = read(`cache/wikt/ru-${ruWord.replace(/ /g, "_")}.txt`);
  const lines = s.split("\n").filter((l) => l.startsWith("|ba="));
  const plain = lines.map((l) => l.replace(/\{\{fonts(?: cyr)?\|([^}]*)\}\}/g, "$1").replace(/\{\{t\|ba\|([^}|]*)\}\}/g, "$1").replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, "$1"));
  if (!plain.some((l) => l.slice(4).split(/[,;]/).map((x) => x.replace(/\(.*?\)/g, "").trim()).includes(text))) {
    fail(`wktru ${ruWord}: «${text}» нет среди ${plain.join(" | ")}`);
  }
  return baText(text, ruWord, {
    ref: "wiktionary-ru",
    url: `https://ru.wiktionary.org/wiki/${enc(ruWord)}`,
    locator: `статья «${ruWord}», раздел «Перевод», строка «Башкирский»`,
  });
}

/** Башкирская Википедия, статья «Башҡорттарҙың телмәр этикеты». */
export function etiket(text, section) {
  if (!ETIKET.includes(text)) fail(`etiket: «${text}» нет в статье`);
  const sec = ETIKET.split(/\n== /).find((p) => p.startsWith(`${section} ==`));
  if (!sec?.includes(text)) fail(`etiket: «${text}» нет в разделе «${section}»`);
  return baText(text, undefined, {
    ref: "wikipedia-ba",
    url: `https://ba.wikipedia.org/w/index.php?title=${enc("Башҡорттарҙың_телмәр_этикеты")}&oldid=${ETIKET_REV}`,
    locator: `статья «Башҡорттарҙың телмәр этикеты», раздел «${section}»`,
  });
}

/** Башкирская Википедия: заголовок статьи (проверен через API: межъязыковая ссылка на ru). */
const BA_TITLES = {
  "Өфө": { ru: "Уфа", pageid: 2021 },
  "Шүлгәнташ": { ru: "Капова пещера", pageid: 4488 },
  "Ағиҙел (йылға)": { ru: "Белая (приток Камы)", pageid: 1649 },
  "Ямантау": { ru: "Ямантау", pageid: 9471 },
  "Һабантуй": { ru: "Сабантуй", pageid: 4450 },
  "Ҡарға бутҡаһы": { ru: "Каргатуй", pageid: 71702 },
  "Йыйын": { ru: "Джиен", pageid: 75390 },
  "Көрәш": { ru: "Куреш", pageid: 92566 },
  "Ҡурай": { ru: "Курай", pageid: 3743 },
  "Ҡымыҙ": { ru: "Кумыс", pageid: 4432 },
};
export function baTitle(title, text) {
  const t = BA_TITLES[title] ?? fail(`baTitle: ${title}`);
  if (!title.startsWith(text)) fail(`baTitle: «${text}» не начало заголовка «${title}»`);
  return baText(text, undefined, {
    ref: "wikipedia-ba",
    url: `https://ba.wikipedia.org/wiki/${enc(title.replace(/ /g, "_"))}`,
    locator: `заголовок статьи «${title}» (pageid ${t.pageid}; русская статья — «${t.ru}»)`,
  });
}

/** Источник русской стороны дуэли (SourceRef без ba). */
/** Викиданные: метка ba элемента qid ровно text, метка ru ровно ru (cache/wikidata/family.json). */
const WD = Object.assign({}, ...["family", "nature"].map((n) => JSON.parse(read(`cache/wikidata/${n}.json`)).entities));
export function wd(qid, text, ru, { alias = false } = {}) {
  const e = WD[qid] ?? fail(`wd: нет ${qid}`);
  if (!alias && e.labels?.ba?.value !== text) fail(`wd ${qid}: метка ba «${e.labels?.ba?.value}» ≠ «${text}»`);
  if (alias && !(e.aliases?.ba ?? []).some((x) => x.value === text)) fail(`wd ${qid}: псевдонима ba «${text}» нет`);
  if (e.labels?.ru?.value !== ru) fail(`wd ${qid}: метка ru «${e.labels?.ru?.value}» ≠ «${ru}»`);
  return baText(text, ru, {
    ref: "wikidata",
    url: `https://www.wikidata.org/w/index.php?title=${qid}&oldid=${e.lastrevid}`,
    locator: `элемент ${qid}, ${alias ? "псевдоним" : "метка"} на башкирском; метка на русском — «${ru}»`,
  });
}

export const ruSrc = {
  wv: (ruHead) => {
    const idx = WV.findIndex((l) => wvHead(l) === ruHead);
    if (idx < 0) fail(`ruSrc.wv: нет «${ruHead}»`);
    return { ref: "wikivoyage-ru-bashkir-phrasebook", url: `https://ru.wikivoyage.org/w/index.php?title=${enc("Башкирский_разговорник")}&oldid=${WV_REV}`, locator: `раздел «${wvSection(idx)}», строка «${ruHead.replace(/''/g, "")}»` };
  },
  rujourn: () => ({
    ref: "rujourn-bashkir-speech-etiquette",
    url: "https://web.archive.org/web/20141022050344/http://rujourn.ru/page.php_id=52.html",
    locator: "абзац «При прощании башкиры произносят: Хуш! Хушыгыз! hаубулыгыз! (до свидания)»",
  }),
};
