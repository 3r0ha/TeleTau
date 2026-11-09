// usage: node hfbatch.mjs <out.json> <mode: filter|search> <q1> <q2> ...
// filter: q = exact ru string (builds "ru"='q'), or raw where-clause if it starts with '@'
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [out, mode, ...qs] = process.argv.slice(2);
const base = "https://datasets-server.huggingface.co";
const ds = "AigizK/bashkir-russian-parallel-corpora";
const store = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const q of qs) {
  const key = `${mode}:${q}`;
  if (store[key]?.rows) { continue; }
  const p = new URLSearchParams({ dataset: ds, config: "default", split: "train", length: "100", offset: "0" });
  if (mode === "filter") p.set("where", q.startsWith("@") ? q.slice(1) : `"ru"='${q.replaceAll("'", "''")}'`);
  else p.set("query", q);
  const url = `${base}/${mode}?${p}`;
  let j;
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
      j = await r.json();
      if (j.rows) break;
      process.stderr.write(`retry ${q}: ${JSON.stringify(j).slice(0, 120)}\n`);
    } catch (e) { process.stderr.write(`retry ${q}: ${e.cause?.code ?? e.message}\n`); }
    await sleep(3000 * (a + 1));
  }
  if (!j?.rows) { console.log(`!! FAILED ${q}`); continue; }
  store[key] = { url, total: j.num_rows_total, rows: j.rows.map(({ row_idx, row }) => ({ row_idx, ru: row.ru, ba: row.ba, corpus: row.corpus })) };
  writeFileSync(out, JSON.stringify(store, null, 1));
  const c = {};
  for (const r of store[key].rows) (c[r.ba] ??= []).push(`${r.row_idx}@${r.corpus}`);
  console.log(`== ${q} (total ${j.num_rows_total})`);
  for (const [k, v] of Object.entries(c).sort((a, b) => b[1].length - a[1].length).slice(0, 15)) console.log(`   ${v.length} ${JSON.stringify(k)}  [${v.slice(0, 3).join(" ")}]`);
}
