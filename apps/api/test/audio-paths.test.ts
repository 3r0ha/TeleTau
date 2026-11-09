// Озвучка со своего сайта: каждая запись настоящего контента в API — путь к копии на сайте (/audio/<id>.m4a и .ogg),
// и эти файлы действительно лежат в apps/web/public/audio (их готовит scripts/prepare-audio.mjs по тому же правилу id).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIO_OGG_TYPE, AUDIO_OPUS_TYPE, audioCopyName, audioOggType, buildCourse, readContent, type AudioValue } from "../src/modules/content/content-import.js";

const PUBLIC = fileURLToPath(new URL("../../web/public", import.meta.url));

function audioValues(node: unknown, out: AudioValue[] = []): AudioValue[] {
  if (Array.isArray(node)) for (const x of node) audioValues(x, out);
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o["audio"] && typeof o["audio"] === "object") out.push(o["audio"] as AudioValue);
    for (const v of Object.values(o)) audioValues(v, out);
  }
  return out;
}

describe("записи произношения настоящего курса (content/course, content/audio)", () => {
  const bundles = readContent().map((f) => buildCourse(f));
  const all = bundles.flatMap((b) => audioValues([b.units, b.lessons, b.exercises, b.words]));

  it("в API — только пути на нашем сайте: AAC m4a основной, затем ogg; копии есть в apps/web/public/audio", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const a of all) {
      expect(a.url).toMatch(/^\/audio\/[0-9a-f]{16}\.m4a$/);
      expect(a.files.map((f) => f.url)).toEqual([a.url, a.url.replace(/\.m4a$/, ".ogg")]);
      for (const f of a.files) expect(existsSync(`${PUBLIC}${f.url}`), `${f.url}: нет файла — pnpm audio`).toBe(true);
      expect(JSON.stringify(a)).not.toContain("upload.wikimedia.org");
      expect(a.source.title).toBeTruthy();
    }
  });

  it("тип Ogg-файла совпадает с содержимым: Vorbis — копия оригинала Commons, Opus — из WAV Lingua Libre", () => {
    for (const a of all) {
      const ogg = a.files[1]!;
      const head = readFileSync(`${PUBLIC}${ogg.url}`).subarray(0, 40);
      expect(head.toString("ascii", 0, 4)).toBe("OggS");
      if (ogg.type === AUDIO_OPUS_TYPE) expect(head.toString("ascii", 28, 36)).toBe("OpusHead");
      else {
        expect(ogg.type).toBe(AUDIO_OGG_TYPE);
        expect(head.toString("ascii", 29, 35)).toBe("vorbis");
      }
    }
    expect(all.some((a) => a.files[1]!.type === AUDIO_OPUS_TYPE)).toBe(true);
  });
});

describe("имя копии записи по ссылке Commons", () => {
  it("Ba-<слово> и Lingua Libre (в адресе upload.wikimedia.org пробел — «_», скобки закодированы)", () => {
    expect(audioCopyName("https://upload.wikimedia.org/wikipedia/commons/e/e3/Ba-%D0%BA%D3%A9%D0%BD.ogg")).toBe("көн.ogg");
    expect(audioCopyName("https://upload.wikimedia.org/wikipedia/commons/9/98/LL-Q13389_%28bak%29-Pastilahor-%D2%A1%D0%BE%D1%88.wav")).toBe("ҡош.wav");
    expect(audioCopyName("https://upload.wikimedia.org/x/LL-Q13389%20(bak)-Speaker-%D0%B1%D0%B0%D0%BB.oga")).toBe("бал.oga");
  });

  it("Ogg-оригинал отдаётся как Vorbis, остальное — как Ogg Opus", () => {
    expect(audioOggType("көн.ogg")).toBe(AUDIO_OGG_TYPE);
    expect(audioOggType("бал.oga")).toBe(AUDIO_OGG_TYPE);
    expect(audioOggType("ҡош.wav")).toBe(AUDIO_OPUS_TYPE);
  });
});
