#!/usr/bin/env node
// Downloads the raw sources for the RB districts/schools directory into $TMPDIR (never into the repo).
//
//   NODE_EXTRA_CA_CERTS=/path/to/russian-trusted-ca.pem node apps/api/data/scripts/fetch-sources.mjs
//
// Sources (see ../rb-directory.README.md):
//   1. Рособрнадзор, open data 7701537808-RAOO — registry of accredited educational organisations (ZIP, ~350 MB).
//   2. ФНС, ГАР (ФИАС) full XML — only the region 02 address-object files are pulled by HTTP Range
//      requests (~20 MB of the 58 GB archive): names, levels and ОКТМО of every settlement of RB.
//   3. Official portal of the Republic of Bashkortostan — list of municipal districts and urban okrugs.
//   4. Wikidata SPARQL — ba.wikipedia article titles for the districts (secondary source for name_ba).
import fs from "node:fs";
import path from "node:path";
import { RemoteZip, downloadFile, fetchText, httpFetch, workDir, writeJson } from "./lib.mjs";

const RAOO_URL = "https://isga.obrnadzor.gov.ru/api/spa/accredreestr/opendata/filezip";
const GAR_INFO_URL = "https://fias.nalog.ru/WebServices/Public/GetLastDownloadFileInfo";
const PORTAL_URL = "https://bashkortostan.ru/thesaurus/governments/local/";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

const only = new Set(process.argv.slice(2));
const want = (k) => only.size === 0 || only.has(k);

const dir = workDir();
const raw = path.join(dir, "raw");
const manifestFile = path.join(raw, "manifest.json");
const manifest = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
  : {};
const now = () => new Date().toISOString();

if (want("raoo")) {
  console.log("[raoo] downloading the accreditation registry…");
  const info = await downloadFile(RAOO_URL, path.join(raw, "raoo.zip"));
  manifest.raoo = { ...info, file: "raoo.zip", fetchedAt: now() };
  console.log(`[raoo] ${(info.bytes / 1e6).toFixed(1)} MB, ${info.contentDisposition ?? ""}`);
}

if (want("gar")) {
  const info = JSON.parse(await fetchText(GAR_INFO_URL));
  const zip = new RemoteZip(info.GarXMLFullURL);
  const entries = await zip.entries();
  const pick = [
    /^02\/AS_ADDR_OBJ_\d{8}_/,
    /^02\/AS_ADDR_OBJ_PARAMS_\d{8}_/,
    /^AS_ADDR_OBJ_TYPES_\d{8}_/,
    /^AS_OBJECT_LEVELS_\d{8}_/,
  ];
  const files = {};
  for (const re of pick) {
    const e = entries.find((x) => re.test(x.name));
    if (!e) throw new Error(`[gar] entry ${re} not found in ${info.GarXMLFullURL}`);
    const local = e.name.replace(/^02\//, "02_").replace(/_[0-9a-f-]{36}(?=\.XML$)/i, "");
    console.log(`[gar] ${e.name} (${(e.csize / 1e6).toFixed(1)} MB compressed)`);
    await zip.extract(e, path.join(raw, local));
    files[re.source] = local;
  }
  manifest.gar = {
    url: info.GarXMLFullURL,
    version: info.TextVersion,
    versionId: info.VersionId,
    lastModified: zip.lastModified,
    files,
    fetchedAt: now(),
  };
}

if (want("portal")) {
  const html = await fetchText(PORTAL_URL);
  fs.writeFileSync(path.join(raw, "portal-local.html"), html);
  manifest.portal = { url: PORTAL_URL, file: "portal-local.html", fetchedAt: now() };
  console.log(`[portal] ${html.length} bytes`);
}

if (want("wikidata")) {
  // Items carrying an 8-digit ОКТМО of an RB municipal district (806xx000) or urban okrug (807xx000),
  // with their ba.wikipedia article title (the ba label is used only if there is no article).
  const query = `SELECT ?item ?oktmo ?ruLabel ?baLabel ?baTitle WHERE {
  ?item p:P764 ?st . ?st ps:P764 ?oktmo .
  FILTER(REGEX(?oktmo, "^80[67][0-9]{2}000$"))
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?item rdfs:label ?ruLabel FILTER(LANG(?ruLabel) = "ru") }
  OPTIONAL { ?item rdfs:label ?baLabel FILTER(LANG(?baLabel) = "ba") }
  OPTIONAL { ?a schema:about ?item ; schema:isPartOf <https://ba.wikipedia.org/> ; schema:name ?baTitle }
}`;
  const res = await httpFetch(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`[wikidata] HTTP ${res.status}`);
  const json = await res.json();
  const rows = json.results.bindings.map((b) => ({
    item: b.item.value.replace("http://www.wikidata.org/entity/", ""),
    oktmo: b.oktmo.value,
    ru: b.ruLabel?.value ?? "",
    baLabel: b.baLabel?.value ?? "",
    baTitle: b.baTitle?.value ?? "",
  }));
  writeJson(path.join(raw, "wikidata-districts.json"), rows);
  manifest.wikidata = { url: WIKIDATA_SPARQL, query, rows: rows.length, fetchedAt: now() };
  console.log(`[wikidata] ${rows.length} rows`);
}

writeJson(manifestFile, manifest);
console.log(`raw data: ${raw}`);
