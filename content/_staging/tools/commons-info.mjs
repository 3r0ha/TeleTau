// Сведения о файлах Commons (url, лицензия, автор, описание) для слов курса: node commons-info.mjs <out.json> <title>...
import { writeFileSync } from "node:fs";
const [out, ...titles] = process.argv.slice(2);
const res = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < titles.length; i += 40) {
  const p = new URLSearchParams({ action: "query", prop: "imageinfo|info", iiprop: "url|extmetadata|size|mime|sha1|timestamp|user", inprop: "url", titles: titles.slice(i, i + 40).join("|"), format: "json" });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${p}`, { headers: { "User-Agent": "TeleTauContentResearch/0.1 (hackathon content research; low-volume)" } });
  const j = await r.json();
  for (const pg of Object.values(j.query.pages)) {
    const ii = pg.imageinfo?.[0];
    const md = ii?.extmetadata ?? {};
    const v = (k) => md[k]?.value;
    res[pg.title] = { pageid: pg.pageid, lastrevid: pg.lastrevid, page: pg.fullurl, url: ii?.url, mime: ii?.mime, size: ii?.size, sha1: ii?.sha1, uploaded: ii?.timestamp, uploader: ii?.user,
      license: v("LicenseShortName"), licenseUrl: v("LicenseUrl"), artist: v("Artist"), credit: v("Credit"), description: v("ImageDescription"), categories: v("Categories") };
  }
  await sleep(2000);
}
writeFileSync(out, JSON.stringify(res, null, 1));
for (const [t, r] of Object.entries(res)) console.log(t, "|", r.license, "|", (r.artist ?? "").replace(/<[^>]+>/g, "").slice(0, 40), "|", r.mime, r.size, "|", (r.description ?? "").replace(/<[^>]+>/g, "").slice(0, 60));
