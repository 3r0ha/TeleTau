import { writeFileSync } from "node:fs";
const out = process.argv[2];
const all = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let page = 1; page <= 40; page++) {
  const url = `https://tatoeba.org/en/api_v0/search?from=bak&to=rus&query=&orphans=no&unapproved=no&sort=created&page=${page}`;
  let j;
  for (let a = 0; a < 4; a++) {
    try { j = await (await fetch(url, { signal: AbortSignal.timeout(40000) })).json(); break; } catch (e) { await sleep(2000); }
  }
  if (!j?.results?.length) break;
  for (const s of j.results) {
    const [direct = [], indirect = []] = s.translations ?? [];
    all.push({ id: s.id, text: s.text, license: s.license, owner: s.user?.username,
      direct: direct.filter((t) => t.lang === "rus").map((t) => ({ id: t.id, text: t.text })),
      indirect: indirect.filter((t) => t.lang === "rus").map((t) => ({ id: t.id, text: t.text })) });
  }
  if (!j.paging?.Sentences?.nextPage) break;
  await sleep(400);
}
writeFileSync(out, JSON.stringify(all, null, 1));
console.log(all.length);
