// Генератор демо-контента: собирает YAML из атомов sources-lib.mjs (каждый атом сверен с копией источника).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { answerTokens } from "../../../packages/bashkir-text/dist/index.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { baTitle } from "./sources-lib.mjs";
import { LESSONS, DUELS, UNIT1_NODES, UNIT2, UNIT_DEFS } from "./content-spec.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
// ── озвучка: записи людей с Wikimedia Commons (cache/commons/info.json; файлы — content/audio/<слово>.<расширение>) ──
const COMMONS = JSON.parse(readFileSync(fileURLToPath(new URL("../cache/commons/info.json", import.meta.url)), "utf8"));
const wordOf = (title) => title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/^(?:Ba|BA)-/, "").replace(/^LL-Q\d+ \([a-z]+\)-[^-]+-/, "");
const RECORDINGS = new Map();
for (const [title, r] of Object.entries(COMMONS)) {
  const url = r.url.split("?")[0];
  const local = join(ROOT, "audio", `${wordOf(title)}.${url.split(".").pop().toLowerCase()}`);
  if (!existsSync(local)) continue; // слово без скачанной записи остаётся без звука
  const artist = (r.artist ?? "").replace(/<[^>]+>/g, "").replace(/^ru:wikt:User:/, "").trim();
  RECORDINGS.set(answerTokens(wordOf(title)).join(" "), {
    url,
    source: { ref: "wikimedia-commons", url: r.page, locator: `${title}; запись — ${artist}` },
    license: r.license,
  });
}
/** audio — каждой строке ba, слово которой записано (уроки и названия мест; дуэлям — нет: звук не должен подсказывать выбор). */
const withAudio = (node) => {
  if (Array.isArray(node)) return node.map(withAudio);
  if (!node || typeof node !== "object") return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, withAudio(v)]));
  const rec = typeof node.ba === "string" ? RECORDINGS.get(answerTokens(node.ba).join(" ")) : undefined;
  return rec ? { ...out, audio: rec } : out;
};

const write = (rel, header, data, { audio = true } = {}) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  const body = stringify(audio ? withAudio(data) : data, { lineWidth: 0, indent: 2, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" });
  writeFileSync(p, `${header.map((l) => `# ${l}`).join("\n")}\n${body}`);
  console.log("wrote", rel);
};

const COMMON = [
  "Башкирский текст — только посимвольные копии из источников content/sources.yaml (source.ref, url, locator);",
  "двойники источника — в raw, в ba — normalize из @teletau/bashkir-text. Проверка: node scripts/check-content.mjs.",
  "Вердикт носителя ставится в review (needs_native_review → native_approved / native_rejected) — строка в docs/native-review-queue.md.",
];

const OPEN_HEADER = (n, title) => [`Юнит ${n} «${title}» — открыт: узлы доступны по порядку после предыдущих юнитов (схема — content/schema/unit.schema.json).`, ...COMMON];

write("course/ba-ru/course.yaml", ["Курс «Башкирский язык» для русскоязычных учеников (схема — content/schema/course.schema.json)."], {
  id: "ba-ru",
  version: 3,
  title_ru: "Башкирский язык",
  direction: "ru-ba",
  units: ["01-ufa", "02-shulgantash", "03-agidel", "04-yamantau", "05-village", "06-sabantuy"],
});

write("course/ba-ru/units/01-ufa/unit.yaml", ["Юнит 1 «Өфө · Знакомство» (схема — content/schema/unit.schema.json).", ...COMMON], {
  id: "01-ufa",
  order: 1,
  status: "open",
  place: { slug: "ufa", title_ru: "Уфа", title_ba: baTitle("Өфө", "Өфө") },
  topic_ru: "Знакомство",
  nodes: UNIT1_NODES,
});

write("course/ba-ru/units/02-shulgantash/unit.yaml", ["Юнит 2 «Шүлгәнташ · Семья» — открыт, узлы доступны по порядку после юнита 1 (схема — content/schema/unit.schema.json).", ...COMMON], {
  id: "02-shulgantash",
  order: 2,
  status: UNIT2.status,
  place: { slug: "shulgantash", title_ru: "Шульган-Таш", title_ba: baTitle("Шүлгәнташ", "Шүлгәнташ") },
  topic_ru: "Семья",
  nodes: UNIT2.nodes,
});

write("course/ba-ru/units/03-agidel/unit.yaml", OPEN_HEADER(3, "Ағиҙел · Природа"), {
  id: "03-agidel",
  order: 3,
  status: UNIT_DEFS["03-agidel"].status,
  place: { slug: "agidel", title_ru: "Агидель", title_ba: baTitle("Ағиҙел (йылға)", "Ағиҙел") },
  topic_ru: "Природа",
  nodes: UNIT_DEFS["03-agidel"].nodes,
});


write("course/ba-ru/units/04-yamantau/unit.yaml", OPEN_HEADER(4, "Ямантау · Числа и время"), {
  id: "04-yamantau",
  order: 4,
  status: UNIT_DEFS["04-yamantau"].status,
  place: { slug: "yamantau", title_ru: "Гора Ямантау", title_ba: baTitle("Ямантау", "Ямантау") },
  topic_ru: "Числа и время",
  nodes: UNIT_DEFS["04-yamantau"].nodes,
});

// Башкирского названия «Башкирской деревни» в источниках нет — title_ba не задан (поле необязательно).
write("course/ba-ru/units/05-village/unit.yaml", OPEN_HEADER(5, "Башкирская деревня · Еда"), {
  id: "05-village",
  order: 5,
  status: UNIT_DEFS["05-village"].status,
  place: { slug: "village", title_ru: "Башкирская деревня" },
  topic_ru: "Еда",
  nodes: UNIT_DEFS["05-village"].nodes,
});

write("course/ba-ru/units/06-sabantuy/unit.yaml", OPEN_HEADER(6, "Сабантуй · Праздники и игры"), {
  id: "06-sabantuy",
  order: 6,
  status: UNIT_DEFS["06-sabantuy"].status,
  place: { slug: "sabantuy", title_ru: "Сабантуй", title_ba: baTitle("Һабантуй", "Һабантуй") },
  topic_ru: "Праздники и игры",
  nodes: UNIT_DEFS["06-sabantuy"].nodes,
});

for (const l of LESSONS) {
  write(`course/ba-ru/units/${l.unit}/lessons/${l.id}.yaml`, [`Урок «${l.title_ru}» (схема — content/schema/lesson.schema.json).`, ...COMMON], l);
}
for (const [unit, duels] of Object.entries(DUELS)) {
  write(`corpus/duels/${unit}.yaml`, [`Дуэли «Помоги языку» юнита ${unit}: русская фраза и два разных засвидетельствованных перевода (схема — content/schema/duels.schema.json).`, ...COMMON], { unit, duels }, { audio: false });
}
