// Короткие повторы /filter (бюджет ≤ 15 мин): node hfquick.mjs <out.json> <where>...
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [out, ...wheres] = process.argv.slice(2);
const store = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const deadline = Date.now() + 14 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const where of wheres) {
  if (store[where]?.rows) continue;
  const p = new URLSearchParams({ dataset: "AigizK/bashkir-russian-parallel-corpora", config: "default", split: "train", where, length: "100" });
  const url = `https://datasets-server.huggingface.co/filter?${p}`;
  while (Date.now() < deadline) {
    try {
      const j = await (await fetch(url, { signal: AbortSignal.timeout(60000) })).json();
      if (j.rows) {
        store[where] = { url, total: j.num_rows_total, rows: j.rows.map(({ row_idx, row }) => ({ row_idx, ru: row.ru, ba: row.ba, corpus: row.corpus })) };
        writeFileSync(out, JSON.stringify(store, null, 1));
        console.log(where, j.num_rows_total, store[where].rows.map((r) => `${r.row_idx}:${r.ba}|${r.ru}|${r.corpus}`).join(" ; "));
        break;
      }
      console.log("retry", where, JSON.stringify(j).slice(0, 80));
    } catch (e) { console.log("retry", where, e.cause?.code ?? e.message); }
    await sleep(8000);
  }
}
console.log("done");
