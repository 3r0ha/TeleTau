#!/usr/bin/env node
// Builds apps/api/data/rb-districts.csv and apps/api/data/rb-schools.csv from the raw sources
// downloaded by fetch-sources.mjs (kept in $TMPDIR, see lib.mjs → workDir()).
//
//   node apps/api/data/scripts/build-rb-directory.mjs
//
// Also refreshes the statistics block of ../rb-directory.README.md and writes a review report
// (unmatched / ambiguous records) to <workdir>/report.json.
import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR,
  attrs,
  childText,
  localZipEntries,
  localZipStream,
  normKey,
  readJson,
  tidy,
  workDir,
  writeCsv,
  writeJson,
  xmlElements,
} from "./lib.mjs";

const dir = workDir();
const raw = path.join(dir, "raw");
const manifest = readJson(path.join(raw, "manifest.json"));
for (const k of ["raoo", "gar", "portal", "wikidata"]) {
  if (!manifest[k]) throw new Error(`source "${k}" is missing — run fetch-sources.mjs first`);
}

const GAR_ACTUAL_END = "2079-06-06";
const garDate = String(manifest.gar.versionId).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
const raooDate = (manifest.raoo.contentDisposition?.match(/data-(\d{8})-/)?.[1] ?? "").replace(
  /^(\d{4})(\d{2})(\d{2})$/,
  "$1-$2-$3",
);

// ---------------------------------------------------------------------------
// 1. ГАР: municipal districts / urban okrugs (level 3) and settlements (levels 5–6) with ОКТМО.

const garFile = (re) => path.join(raw, manifest.gar.files[re]);
const objects = new Map();
for await (const el of xmlElements(
  fs.createReadStream(garFile("^02\\/AS_ADDR_OBJ_\\d{8}_")),
  "OBJECT",
)) {
  const a = attrs(el);
  if (a.ISACTUAL !== "1" || a.ISACTIVE !== "1") continue;
  const level = Number(a.LEVEL);
  if (level > 6) continue;
  objects.set(a.OBJECTID, { id: a.OBJECTID, name: a.NAME, type: a.TYPENAME, level });
}
for await (const el of xmlElements(
  fs.createReadStream(garFile("^02\\/AS_ADDR_OBJ_PARAMS_\\d{8}_")),
  "PARAM",
)) {
  const a = attrs(el);
  if (a.TYPEID !== "7" || a.ENDDATE !== GAR_ACTUAL_END) continue; // 7 = ОКТМО
  const o = objects.get(a.OBJECTID);
  if (o) o.oktmo = a.VALUE;
}

const districts = [];
for (const o of objects.values()) {
  if (o.level !== 3) continue;
  if (!/^80[67]\d{2}000$/.test(o.oktmo ?? ""))
    throw new Error(`GAR: unexpected ОКТМО ${o.oktmo} for ${o.name}`);
  const kind = o.type === "м.р-н" ? "municipal_district" : o.type === "г.о." ? "urban_okrug" : null;
  if (!kind) throw new Error(`GAR: unexpected level-3 type ${o.type} (${o.name})`);
  districts.push({
    oktmo: o.oktmo,
    kind,
    gar_name: o.name,
    name_ru: kind === "municipal_district" ? `${o.name} район` : `городской округ ${o.name}`,
  });
}
districts.sort((a, b) => a.oktmo.localeCompare(b.oktmo));
const districtByOktmo = new Map(districts.map((d) => [d.oktmo, d]));
const districtOf = (oktmo) => (oktmo ? districtByOktmo.get(`${oktmo.slice(0, 5)}000`) : undefined);

// Settlements: name → set of district ОКТМО (settlement names repeat across districts).
const settlements = new Map(); // key: normalised name → Map(districtOktmo → [{type, level}])
const cityDistrict = new Map(); // "уфа" → 80701000 (all 21 cities of RB, level 5 "г.")
for (const o of objects.values()) {
  if (o.level !== 5 && o.level !== 6) continue;
  const d = districtOf(o.oktmo);
  if (!d) continue;
  const key = normKey(o.name);
  if (!settlements.has(key)) settlements.set(key, new Map());
  const m = settlements.get(key);
  if (!m.has(d.oktmo)) m.set(d.oktmo, []);
  m.get(d.oktmo).push({ type: o.type, level: o.level });
  if (o.level === 5 && o.type === "г.") {
    // nominative + genitive ("г. Уфы", "города Стерлитамака", "г. Октябрьского", "г. Агидели")
    const forms = [
      key,
      `${key}а`,
      key.replace(/а$/, "ы"),
      key.replace(/й$/, "я"),
      key.replace(/ь$/, "и"),
    ];
    forms.push(key.replace(/ий$/, "ого"), key.replace(/ье$/, "ья"));
    for (const f of forms) cityDistrict.set(f, d.oktmo);
  }
}

// Municipal district adjective ("Абзелиловский") → ОКТМО; "ё" folded, both spellings accepted.
const districtByAdjective = new Map();
for (const d of districts) {
  if (d.kind === "municipal_district") districtByAdjective.set(normKey(d.gar_name), d.oktmo);
}

// ---------------------------------------------------------------------------
// 2. Cross-check with the list on the official portal of the Republic.

const portalHtml = fs.readFileSync(path.join(raw, manifest.portal.file), "utf8");
const portalNames = [
  ...portalHtml.matchAll(/<a[^>]*>([^<]*?(?:Муниципальный район|городского округа)[^<]*)<\/a>/g),
]
  .map((m) => tidy(m[1]))
  .filter((s) => /Республики Башкортостан$/.test(s));
const portalCheck = { listed: portalNames.length, unmatchedPortal: [], unmatchedGar: [] };
const portalKeys = new Set();
for (const s of portalNames) {
  const md = s.match(/^Муниципальный район (.+?) район Республики Башкортостан$/);
  const uo = s.match(/городского округа (.+?) Республики Башкортостан$/);
  const key = md
    ? `md:${normKey(md[1])}`
    : uo
      ? `uo:${normKey(uo[1].replace("закрытое административно-территориальное образование", "ЗАТО"))}`
      : null;
  if (!key) portalCheck.unmatchedPortal.push(s);
  else portalKeys.add(key);
}
for (const d of districts) {
  const key =
    d.kind === "municipal_district" ? `md:${normKey(d.gar_name)}` : `uo:${normKey(d.gar_name)}`;
  if (!portalKeys.has(key)) portalCheck.unmatchedGar.push(d.name_ru);
}

// ---------------------------------------------------------------------------
// 3. Bashkir names: ba.wikipedia article titles via Wikidata (secondary source, needs native review).

const BASHKIR_LETTERS = /^[А-Яа-яЁёӘәӨөҮүҒғҠҡҢңҘҙҪҫҺһ\s-]+$/u;
const wikidata = readJson(path.join(raw, "wikidata-districts.json"));
const baIssues = [];
for (const d of districts) {
  const rows = wikidata.filter((r) => r.oktmo === d.oktmo);
  const titles = [...new Set(rows.map((r) => r.baTitle || r.baLabel).filter(Boolean))];
  d.name_ba = "";
  d.wikidata = rows.map((r) => r.item).join("+");
  if (titles.length !== 1) {
    baIssues.push({ oktmo: d.oktmo, reason: titles.length ? "ambiguous" : "missing", titles });
    continue;
  }
  const ba = tidy(titles[0].replace(/\s*\([^)]*\)$/, "")); // drop ba.wiki disambiguation "(Башҡортостан)"
  if (!BASHKIR_LETTERS.test(ba) || ba.normalize("NFC") !== ba) {
    baIssues.push({ oktmo: d.oktmo, reason: "non-Bashkir characters", titles });
    continue;
  }
  d.name_ba = ba;
}

// ---------------------------------------------------------------------------
// 4. Рособрнадзор accreditation registry: general-education organisations of RB and their branches.

const GENERAL_ED =
  /(^|\|)(Начальное общее образование|Основное общее образование|Среднее общее образование|Среднее \(полное\) общее образование|Общее образование)(\||$)/;
const SCHOOL_NAME = /школ|гимнази|лице[йя]|интернат|кадетск|общеобразовательн/i;
// Organisational forms that are not schools even when they run general-education programmes
// (colleges, universities, special closed institutions, individual entrepreneurs). Words like
// "академика" or "университета" inside a school's own name ("Гимназия № 82 УГНТУ") do not count.
const NOT_SCHOOL =
  /профессиональн\S*\s+образовательн|высшего\s+(?:профессионального\s+)?образования|колледж|техникум|индивидуальный предприниматель/i;

const raooZip = path.join(raw, manifest.raoo.file);
const xmlEntry = localZipEntries(raooZip).find((e) => /\.xml$/i.test(e.name));
if (!xmlEntry) throw new Error("RAOO: no XML in the archive");

const isRb = (s) => /Башкортостан/i.test(s ?? "");
const orgs = new Map(); // INN → org
const stat = { certificates: 0, rbActive: 0, notGeneralEd: 0, notSchoolName: 0, duplicateInn: 0 };
const excluded = [];

function programsOf(xml) {
  return [...xml.matchAll(/<EducationalProgram>([\s\S]*?)<\/EducationalProgram>/g)].map(
    (m) => `${childText(m[1], "EduLevelName") ?? ""}|${childText(m[1], "ProgrammName") ?? ""}`,
  );
}

for await (const cert of xmlElements(localZipStream(raooZip, xmlEntry), "Certificate")) {
  stat.certificates++;
  if (!cert.includes("Башкортостан")) continue;
  const head = cert.slice(0, cert.indexOf("<ActualEducationOrganization>"));
  const aeoXml =
    cert.match(/<ActualEducationOrganization>([\s\S]*?)<\/ActualEducationOrganization>/)?.[1] ?? "";
  const regionOk = childText(head, "RegionCode") === "02" || isRb(childText(aeoXml, "RegionName"));
  if (!regionOk || childText(head, "StatusName") !== "Действующее") continue;
  stat.rbActive++;

  const supplements = [...cert.matchAll(/<Supplement>([\s\S]*?)<\/Supplement>/g)].map((m) => m[1]);
  const active = supplements.filter((s) => childText(s, "StatusName") === "Действующее");
  const own = active.filter((s) => childText(s, "IsForBranch") !== "1");
  const fullName = tidy(childText(aeoXml, "FullName") || childText(head, "EduOrgFullName"));
  const progs = (own.length ? own : active).flatMap(programsOf);
  if (!progs.some((p) => GENERAL_ED.test(p))) {
    stat.notGeneralEd++;
    continue;
  }
  if (!SCHOOL_NAME.test(fullName) || NOT_SCHOOL.test(fullName)) {
    stat.notSchoolName++;
    // Individual entrepreneurs are people: their names are personal data and are never stored.
    if (!/индивидуальный предприниматель/i.test(fullName)) excluded.push(fullName);
    continue;
  }
  const inn = childText(aeoXml, "INN") || childText(head, "EduOrgINN") || "";
  const issue = childText(head, "IssueDate") ?? "";
  const org = {
    certId: childText(head, "Id"),
    aeoId: childText(aeoXml, "Id"),
    issue,
    name_ru: fullName,
    short_name_ru: tidy(childText(aeoXml, "ShortName") || childText(head, "EduOrgShortName")),
    inn,
    address: tidy(childText(aeoXml, "PostAddress") || childText(head, "PostAddress")),
    branches: new Map(),
  };
  for (const s of supplements.filter((x) => childText(x, "IsForBranch") === "1")) {
    const b =
      s.match(/<ActualEducationOrganization>([\s\S]*?)<\/ActualEducationOrganization>/)?.[1] ?? "";
    const name = tidy(childText(b, "FullName") || childText(s, "EduOrgFullName"));
    if (!name) continue;
    const id = childText(b, "Id") || `kpp:${childText(s, "EduOrgKPP")}:${normKey(name)}`;
    const prev = org.branches.get(id);
    const isActive = childText(s, "StatusName") === "Действующее";
    const branch = {
      aeoId: childText(b, "Id"),
      name_ru: name,
      short_name_ru: tidy(childText(b, "ShortName") || childText(s, "EduOrgShortName")),
      address: tidy(childText(b, "PostAddress") || childText(s, "EduOrgAddress")),
      active: isActive || prev?.active === true,
    };
    if (!prev || isActive) org.branches.set(id, branch);
    else prev.active = branch.active;
  }
  const key = inn || `cert:${org.certId}`;
  const prev = orgs.get(key);
  if (prev) {
    stat.duplicateInn++;
    if (prev.issue >= org.issue) {
      for (const [id, b] of org.branches) if (!prev.branches.has(id)) prev.branches.set(id, b);
      continue;
    }
    for (const [id, b] of prev.branches) if (!org.branches.has(id)) org.branches.set(id, b);
  }
  orgs.set(key, org);
}

// ---------------------------------------------------------------------------
// 5. Assigning every school / branch to a municipal district or urban okrug (ОКТМО).

// All matching runs on normKey()-ed text (lower case, "ё"→"е"): the registry mixes "Г САЛАВАТ",
// "г, Уфа", "Башкортостан.г. Октябрьский" and "р-н Абзелиловский".
const B = "(?:^|[\\s,.;:(])"; // left boundary
const E = "(?=[\\s,.;:)]|$)"; // right boundary
const ADJ = "[а-я]+(?:-[а-я]+)?(?:ский|цкий|ой|ый|ий)";
const reDistrictInText = new RegExp(
  `${B}(${ADJ})\\s+(?:муниципальн\\S*\\s+)?(?:р-н|р-на|район\\S*|р\\.)${E}`,
  "g",
);
const reDistrictPrefixed = new RegExp(`${B}(?:р-н|район|м\\.р-н)\\.?\\s+(${ADJ})${E}`, "g");
const reCity = new RegExp(
  `${B}(?:город|гор\\.|г\\.|г(?=[\\s,]))[\\s,.]*([а-я]+(?:-[а-я]+)?)${E}`,
  "g",
);
const reSettlement = new RegExp(
  `${B}(?:село|деревня|дер\\.|рабочий поселок|поселок|пос\\.|рп\\.|рп(?=\\s)|р\\.п\\.|хутор|станция|с\\.ст\\.|ст\\.|с\\.|с(?=\\s)|д\\.|д(?=\\s)|п\\.|п(?=\\s)|х\\.|х(?=\\s))\\s*` +
    `([а-я0-9][а-я0-9-]*(?:\\s+[а-я0-9][а-я0-9-]*)?)${E}`,
  "g",
);

function districtsMentioned(text) {
  const t = normKey(text);
  const out = new Set();
  for (const re of [reDistrictInText, reDistrictPrefixed]) {
    for (const m of t.matchAll(re)) {
      const o = districtByAdjective.get(m[1]);
      if (o) out.add(o);
    }
  }
  return out;
}

function citiesMentioned(text) {
  const t = normKey(text);
  const out = new Set();
  for (const m of t.matchAll(reCity)) {
    const o = cityDistrict.get(m[1]);
    if (o) out.add(o);
  }
  return out;
}

function settlementCandidates(text) {
  const t = normKey(text);
  const out = [];
  for (const m of t.matchAll(reSettlement)) {
    const words = m[1].trim();
    const first = words.split(/\s+/)[0];
    const name = settlements.has(words) ? words : first;
    const hit = settlements.get(name);
    if (hit) out.push({ name, districts: new Set(hit.keys()) });
  }
  return out;
}

const methodStats = {};
const unresolved = [];

function assignDistrict(rec, parentOktmo) {
  const addr = rec.address ?? "";
  const name = rec.name_ru ?? "";
  // (a) the address names the municipal district explicitly ("Кугарчинский район")
  const addrDistricts = districtsMentioned(addr);
  if (addrDistricts.size === 1) return [[...addrDistricts][0], "address-district"];
  // (b) the address names a city: an urban okrug, or a district town (Белебей → Белебеевский)
  const addrCities = citiesMentioned(addr);
  if (addrDistricts.size === 0 && addrCities.size === 1)
    return [[...addrCities][0], "address-city"];
  // (c) a settlement in the address that is unique within RB (ГАР), or consistent with (a)
  const sets = settlementCandidates(addr);
  for (const s of sets) {
    if (
      s.districts.size === 1 &&
      (addrDistricts.size === 0 || addrDistricts.has([...s.districts][0]))
    ) {
      return [[...s.districts][0], "address-settlement"];
    }
    if (addrDistricts.size > 1) {
      const both = [...s.districts].filter((d) => addrDistricts.has(d));
      if (both.length === 1) return [both[0], "address-settlement+district"];
    }
  }
  // (d) the official name of the organisation ("…муниципального района Кугарчинский район…",
  //     "…городского округа город Уфа…", "…с. Мраково…")
  const nameDistricts = districtsMentioned(name);
  if (nameDistricts.size === 1) return [[...nameDistricts][0], "name-district"];
  const okrug = normKey(name).match(
    /городского округа\s+(?:зато\s+|закрытое административно-территориальное образование\s+)?город\S*\s+([а-я-]+)/,
  );
  if (okrug && cityDistrict.has(okrug[1])) return [cityDistrict.get(okrug[1]), "name-okrug"];
  const nameCities = citiesMentioned(name);
  if (nameCities.size === 1) return [[...nameCities][0], "name-city"];
  for (const s of settlementCandidates(name)) {
    if (s.districts.size === 1) return [[...s.districts][0], "name-settlement"];
  }
  // (e) a branch with an ambiguous address inherits the district of its parent organisation
  //     when one of the settlement candidates lies in that district
  if (parentOktmo) {
    const inParent = [...sets, ...settlementCandidates(name)].some((s) =>
      s.districts.has(parentOktmo),
    );
    if (inParent) return [parentOktmo, "parent-district"];
  }
  return [null, "unresolved"];
}

// Every independent hint about the district; a hint that disagrees with the chosen district is
// reported for manual review (report.json → conflicts).
function signals(rec) {
  const out = new Set();
  for (const t of [rec.address ?? "", rec.name_ru ?? ""]) {
    for (const d of districtsMentioned(t)) out.add(d);
    for (const d of citiesMentioned(t)) out.add(d);
    for (const s of settlementCandidates(t))
      if (s.districts.size === 1) out.add([...s.districts][0]);
  }
  return out;
}
const conflicts = [];
function checkConflict(rec, oktmo, method) {
  const other = [...signals(rec)].filter((d) => d !== oktmo);
  if (other.length) {
    conflicts.push({
      name: rec.name_ru,
      address: rec.address,
      chosen: districtByOktmo.get(oktmo).name_ru,
      method,
      alsoMentioned: other.map((d) => districtByOktmo.get(d).name_ru),
    });
  }
}

const schoolRows = [];
const sourceTag = `rosobrnadzor-raoo:${raooDate}`;
for (const org of orgs.values()) {
  const [oktmo, method] = assignDistrict(org);
  methodStats[method] = (methodStats[method] ?? 0) + 1;
  if (!oktmo)
    unresolved.push({ kind: "org", name: org.name_ru, address: org.address, inn: org.inn });
  else checkConflict(org, oktmo, method);
  if (oktmo)
    schoolRows.push({
      district_oktmo: oktmo,
      name_ru: org.name_ru,
      short_name_ru: org.short_name_ru,
      name_ba: "",
      inn: org.inn,
      address: org.address,
      category: "",
      bashkir_medium: "",
      source: `${sourceTag}#${org.aeoId || org.certId};oktmo-by=${method}`,
      _branch: false,
    });
  for (const b of org.branches.values()) {
    if (!b.active) continue;
    const [bOktmo, bMethod] = assignDistrict(b, oktmo);
    methodStats[`branch:${bMethod}`] = (methodStats[`branch:${bMethod}`] ?? 0) + 1;
    if (!bOktmo) {
      unresolved.push({ kind: "branch", name: b.name_ru, address: b.address, parent: org.name_ru });
      continue;
    }
    checkConflict(b, bOktmo, bMethod);
    schoolRows.push({
      district_oktmo: bOktmo,
      name_ru: b.name_ru,
      short_name_ru: b.short_name_ru,
      name_ba: "",
      inn: "", // a branch is not a legal entity: no INN of its own
      address: b.address,
      category: "",
      bashkir_medium: "",
      source: `${sourceTag}#${b.aeoId || "branch"};branch-of=${org.inn};oktmo-by=${bMethod}`,
      _branch: true,
    });
  }
}

// De-duplicate on (district, normalised name): the same branch can appear under two certificates.
const seen = new Map();
const dupes = [];
const rows = [];
for (const r of schoolRows) {
  const key = `${r.district_oktmo}|${normKey(r.name_ru)}`;
  if (seen.has(key)) {
    dupes.push(r.name_ru);
    continue;
  }
  seen.set(key, r);
  rows.push(r);
}
const collator = new Intl.Collator("ru");
rows.sort(
  (a, b) =>
    a.district_oktmo.localeCompare(b.district_oktmo) || collator.compare(a.name_ru, b.name_ru),
);

// ---------------------------------------------------------------------------
// 6. Output.

writeCsv(
  path.join(DATA_DIR, "rb-districts.csv"),
  ["oktmo", "kind", "name_ru", "name_ba", "source"],
  districts.map((d) => ({
    ...d,
    source:
      `fns-gar:${garDate}` + (d.name_ba ? `;name_ba=ba.wikipedia(wikidata:${d.wikidata})` : ""),
  })),
);
writeCsv(
  path.join(DATA_DIR, "rb-schools.csv"),
  [
    "district_oktmo",
    "name_ru",
    "short_name_ru",
    "name_ba",
    "inn",
    "address",
    "category",
    "bashkir_medium",
    "source",
  ],
  rows,
);

const perDistrict = new Map(districts.map((d) => [d.oktmo, 0]));
for (const r of rows) perDistrict.set(r.district_oktmo, perDistrict.get(r.district_oktmo) + 1);
const counts = [...perDistrict.entries()].map(([oktmo, n]) => ({
  oktmo,
  name: districtByOktmo.get(oktmo).name_ru,
  n,
}));
counts.sort((a, b) => a.n - b.n);

const stats = {
  generatedAt: new Date().toISOString(),
  sources: {
    raoo: { file: manifest.raoo.contentDisposition, fetchedAt: manifest.raoo.fetchedAt },
    gar: {
      version: manifest.gar.version,
      url: manifest.gar.url,
      fetchedAt: manifest.gar.fetchedAt,
    },
    portal: { url: manifest.portal.url, fetchedAt: manifest.portal.fetchedAt, check: portalCheck },
    wikidata: { fetchedAt: manifest.wikidata.fetchedAt, issues: baIssues },
  },
  districts: {
    total: districts.length,
    municipal_district: districts.filter((d) => d.kind === "municipal_district").length,
    urban_okrug: districts.filter((d) => d.kind === "urban_okrug").length,
    withNameBa: districts.filter((d) => d.name_ba).length,
  },
  raoo: stat,
  schools: {
    total: rows.length,
    organisations: rows.filter((r) => !r._branch).length,
    branches: rows.filter((r) => r._branch).length,
    unresolved: unresolved.length,
    conflictsForReview: conflicts.length,
    duplicatesDropped: dupes.length,
    methods: methodStats,
    perDistrictMin: counts[0],
    perDistrictMax: counts[counts.length - 1],
    districtsWithoutSchools: counts.filter((c) => c.n === 0).map((c) => c.name),
  },
};
writeJson(path.join(dir, "report.json"), {
  stats,
  unresolved,
  conflicts,
  excluded,
  duplicates: dupes,
  perDistrict: counts,
});

// Statistics block in the README (between the markers), so the numbers never drift from the data.
const readme = path.join(DATA_DIR, "rb-directory.README.md");
if (fs.existsSync(readme)) {
  const s = stats.schools;
  const block = [
    "<!-- stats:start (generated by scripts/build-rb-directory.mjs — do not edit by hand) -->",
    "",
    `| Показатель | Значение |`,
    `|---|---|`,
    `| Выгрузка реестра аккредитации (Рособрнадзор) | ${raooDate} |`,
    `| Версия ГАР (ФНС) | ${manifest.gar.version} |`,
    `| Районы / городские округа | ${stats.districts.municipal_district} / ${stats.districts.urban_okrug} (всего ${stats.districts.total}) |`,
    `| С названием на башкирском (из ba.wikipedia, на проверку) | ${stats.districts.withNameBa} из ${stats.districts.total} |`,
    `| Действующих свидетельств об аккредитации в РБ (все уровни) | ${stat.rbActive} |`,
    `| Из них без программ общего образования / не школы по названию | ${stat.notGeneralEd} / ${stat.notSchoolName} |`,
    `| Школ — юридических лиц | ${s.organisations} |`,
    `| Филиалов (отдельные строки, без ИНН) | ${s.branches} |`,
    `| Всего строк в rb-schools.csv | ${s.total} |`,
    `| Не удалось привязать к району (не попали в CSV) | ${s.unresolved} |`,
    `| Мин. школ на район | ${s.perDistrictMin.n} (${s.perDistrictMin.name}) |`,
    `| Макс. школ на район | ${s.perDistrictMax.n} (${s.perDistrictMax.name}) |`,
    `| Районов без школ | ${s.districtsWithoutSchools.length ? s.districtsWithoutSchools.join(", ") : "нет"} |`,
    "",
    "Способ привязки к району (`oktmo-by` в столбце `source`):",
    "",
    ...Object.entries(s.methods)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- \`${k}\` — ${v}`),
    "",
    "<!-- stats:end -->",
  ].join("\n");
  const text = fs.readFileSync(readme, "utf8");
  const re = /<!-- stats:start[\s\S]*?<!-- stats:end -->/;
  if (re.test(text)) fs.writeFileSync(readme, text.replace(re, block));
}

console.log(JSON.stringify(stats, null, 2));
console.log(`report: ${path.join(dir, "report.json")}`);
