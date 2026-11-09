#!/usr/bin/env node
// Integrity checks for apps/api/data/rb-districts.csv and rb-schools.csv. Exit code 1 on any error.
//
//   node apps/api/data/scripts/verify-rb-directory.mjs
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, normKey, parseCsv, parseCsvRecords } from "./lib.mjs";

const errors = [];
const warn = [];
const fail = (msg) => errors.push(msg);

function load(file, header) {
  const text = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
  if (text.charCodeAt(0) === 0xfeff) fail(`${file}: has a BOM`);
  const first = text.slice(0, text.indexOf("\r\n"));
  if (first !== header.join(","))
    fail(`${file}: header is "${first}", expected "${header.join(",")}"`);
  if (!text.endsWith("\r\n")) fail(`${file}: must end with CRLF`);
  const rows = parseCsv(text);
  // RFC 4180 round trip: every record has exactly the header's number of fields.
  let quoted = false;
  let lineBreaks = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (!quoted && text[i] === "\n") {
      if (text[i - 1] !== "\r") fail(`${file}: bare LF outside quotes at offset ${i}`);
      lineBreaks++;
    }
  }
  if (quoted) fail(`${file}: unbalanced quotes`);
  if (lineBreaks - 1 !== rows.length)
    fail(`${file}: ${lineBreaks - 1} records vs ${rows.length} parsed`);
  parseCsvRecords(text).forEach((r, i) => {
    if (r.length !== header.length)
      fail(`${file}: record ${i + 1} has ${r.length} fields, expected ${header.length}`);
  });
  if (text.normalize("NFC") !== text) fail(`${file}: text is not in Unicode NFC`);
  return rows;
}

// Bashkir letters must be the proper Cyrillic code points (CLAUDE.md, rule 7).
// Whitelist: Russian Cyrillic + the nine Bashkir letters (ә U+04D9, ө U+04E9, ү U+04AF, ғ U+0493,
// ҡ U+04A1, ң U+04A3, ҙ U+0499, ҫ U+04AB, һ U+04BB and their capitals), space and hyphen. Everything
// else is an error — in particular Latin look-alikes (ə U+0259, ç, ş, h…), Tatar җ U+0497 and
// Kazakh қ U+049B.
const ALLOWED_BA_CHAR = /^[А-Яа-яЁёӘәӨөҮүҒғҠҡҢңҘҙҪҫҺһ -]$/u;
function checkBashkir(where, s) {
  if (!s) return;
  const bad = [...new Set([...s].filter((ch) => !ALLOWED_BA_CHAR.test(ch)))];
  if (bad.length) {
    const cps = bad.map(
      (c) => `"${c}" U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
    );
    fail(`${where}: characters outside the Bashkir alphabet ${cps.join(", ")} in "${s}"`);
  }
}

function innValid(inn) {
  if (!/^\d{10}$/.test(inn)) return false;
  const k = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum = k.reduce((acc, w, i) => acc + w * Number(inn[i]), 0);
  return (sum % 11) % 10 === Number(inn[9]);
}

const PII = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, "e-mail"],
  [/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/, "phone"],
  [/индивидуальный предприниматель/i, "individual entrepreneur"],
];

// ---------------------------------------------------------------------------

const districts = load("rb-districts.csv", ["oktmo", "kind", "name_ru", "name_ba", "source"]);
const oktmos = new Set();
for (const d of districts) {
  const at = `rb-districts.csv ${d.oktmo}`;
  if (!/^80[67]\d{2}000$/.test(d.oktmo)) fail(`${at}: bad ОКТМО`);
  if (oktmos.has(d.oktmo)) fail(`${at}: duplicate ОКТМО`);
  oktmos.add(d.oktmo);
  const expectedKind = d.oktmo[2] === "6" ? "municipal_district" : "urban_okrug";
  if (d.kind !== expectedKind) fail(`${at}: kind ${d.kind}, ОКТМО implies ${expectedKind}`);
  if (!d.name_ru) fail(`${at}: empty name_ru`);
  if (!d.source) fail(`${at}: empty source`);
  checkBashkir(`${at} name_ba`, d.name_ba);
}
const nMd = districts.filter((d) => d.kind === "municipal_district").length;
const nUo = districts.filter((d) => d.kind === "urban_okrug").length;
if (nMd !== 54)
  warn.push(`municipal districts: ${nMd} (54 expected as of 2026 — check for a municipal reform)`);
if (nUo !== 9) warn.push(`urban okrugs: ${nUo} (9 expected as of 2026)`);
const districtNames = new Set(districts.map((d) => normKey(d.name_ru)));
if (districtNames.size !== districts.length) fail("rb-districts.csv: duplicate name_ru");

const schools = load("rb-schools.csv", [
  "district_oktmo",
  "name_ru",
  "short_name_ru",
  "name_ba",
  "inn",
  "address",
  "category",
  "bashkir_medium",
  "source",
]);
const inns = new Map();
const pairs = new Set();
const perDistrict = new Map([...oktmos].map((o) => [o, 0]));
schools.forEach((s, i) => {
  const at = `rb-schools.csv row ${i + 2}`;
  if (!oktmos.has(s.district_oktmo))
    fail(`${at}: district_oktmo ${s.district_oktmo} not in rb-districts.csv`);
  else perDistrict.set(s.district_oktmo, perDistrict.get(s.district_oktmo) + 1);
  if (!s.name_ru) fail(`${at}: empty name_ru`);
  if (s.inn) {
    if (!innValid(s.inn)) fail(`${at}: INN ${s.inn} fails the checksum`);
    if (inns.has(s.inn)) fail(`${at}: duplicate INN ${s.inn} (also row ${inns.get(s.inn)})`);
    inns.set(s.inn, i + 2);
  }
  const key = `${s.district_oktmo}|${normKey(s.name_ru)}`;
  if (pairs.has(key)) fail(`${at}: duplicate (district, name)`);
  pairs.add(key);
  if (s.category && !["city_large", "city_small", "rural", "small_rural"].includes(s.category)) {
    fail(`${at}: bad category ${s.category}`);
  }
  if (s.bashkir_medium && !["true", "false"].includes(s.bashkir_medium))
    fail(`${at}: bad bashkir_medium`);
  if (!s.source) fail(`${at}: empty source`);
  checkBashkir(`${at} name_ba`, s.name_ba);
  for (const field of ["name_ru", "short_name_ru", "address"]) {
    for (const [re, what] of PII)
      if (re.test(s[field])) fail(`${at}: ${field} looks like it contains ${what}`);
    if ([...s[field]].some((ch) => ch.charCodeAt(0) < 0x20))
      fail(`${at}: control characters in ${field}`);
  }
});

const counts = [...perDistrict.values()];
const empty = [...perDistrict].filter(([, n]) => n === 0).map(([o]) => o);
if (empty.length) warn.push(`districts without schools: ${empty.join(", ")}`);

console.log(
  `districts: ${districts.length} (${nMd} municipal districts, ${nUo} urban okrugs), ` +
    `with name_ba: ${districts.filter((d) => d.name_ba).length}`,
);
console.log(
  `schools: ${schools.length} (with INN: ${inns.size}, branches: ${schools.length - inns.size}); ` +
    `per district min ${Math.min(...counts)}, max ${Math.max(...counts)}`,
);
for (const w of warn) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors.slice(0, 50)) console.error(`error: ${e}`);
  console.error(`${errors.length} error(s)`);
  process.exit(1);
}
console.log("OK");
