// Озвучка со своего сайта (scripts/prepare-audio.mjs): имя и id копии записи, актуальность файлов
// в apps/web/public/audio.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { audioCopyPath, audioUrls, audioWord, isOggOriginal } from "../lib/audio.mjs";
import { cafOpusToOgg, isOggOpus, isOggVorbis, oggCrc } from "../lib/ogg-opus.mjs";
import { check, collectClips, PUBLIC_DIR } from "../prepare-audio.mjs";

const REPO = join(import.meta.dirname, "../..");

test("audio copy path: word from the Commons file name (Ba-… and Lingua Libre)", () => {
  assert.deepEqual(audioWord("https://upload.wikimedia.org/wikipedia/commons/e/e3/Ba-%D0%BA%D3%A9%D0%BD.ogg"), { word: "көн", ext: "ogg" });
  assert.equal(audioCopyPath("https://upload.wikimedia.org/x/LL-Q13389%20(bak)-Speaker-%D0%B1%D0%B0%D0%BB.oga"), "content/audio/бал.oga");
  // Адрес upload.wikimedia.org: пробел — «_», скобки закодированы.
  assert.deepEqual(audioWord("https://upload.wikimedia.org/wikipedia/commons/9/98/LL-Q13389_%28bak%29-Pastilahor-%D2%A1%D0%BE%D1%88.wav"), { word: "ҡош", ext: "wav" });
});

test("ogg copy rule: Ogg originals in content/audio are Vorbis (copied as is), the rest become Ogg Opus", () => {
  for (const c of collectClips()) {
    const original = readFileSync(join(REPO, c.copy));
    const ogg = readFileSync(join(REPO, PUBLIC_DIR, `${c.id}.ogg`));
    if (isOggOriginal(c.copy)) assert.ok(isOggVorbis(original), `${c.copy}: не Ogg Vorbis — тип audio/ogg; codecs="vorbis" в API был бы неверен`);
    else assert.ok(isOggOpus(ogg), `${c.copy}: на сайте не Ogg Opus`);
  }
});

/** CAF с Opus, как его пишет afconvert: desc, pakt (размеры пакетов — числа переменной длины), data. */
function caf({ packets, priming, valid, channels = 1 }) {
  const chunk = (type, body) => {
    const h = Buffer.alloc(12);
    h.write(type, 0, "ascii");
    h.writeBigInt64BE(BigInt(body.length), 4);
    return Buffer.concat([h, body]);
  };
  const desc = Buffer.alloc(32);
  desc.writeDoubleBE(48000, 0);
  desc.write("opus", 8, "ascii");
  desc.writeUInt32BE(960, 20);
  desc.writeUInt32BE(channels, 24);
  const varint = (n) => (n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f]);
  const pakt = Buffer.concat([Buffer.alloc(24), Buffer.from(packets.flatMap((p) => varint(p.length)))]);
  pakt.writeBigInt64BE(BigInt(packets.length), 0);
  pakt.writeBigInt64BE(BigInt(valid), 8);
  pakt.writeInt32BE(priming, 16);
  pakt.writeInt32BE(packets.length * 960 - priming - valid, 20);
  const head = Buffer.from([0x63, 0x61, 0x66, 0x66, 0, 1, 0, 0]);
  return Buffer.concat([head, chunk("desc", desc), chunk("pakt", pakt), chunk("data", Buffer.concat([Buffer.alloc(4), ...packets]))]);
}

/** Страницы Ogg: флаги, позиция, номер и пакеты (сегменты склеены по таблице). */
function oggPages(buf) {
  const pages = [];
  for (let p = 0; p < buf.length; ) {
    assert.equal(buf.toString("ascii", p, p + 4), "OggS");
    const n = buf[p + 26];
    const lacing = [...buf.subarray(p + 27, p + 27 + n)];
    const size = 27 + n + lacing.reduce((a, b) => a + b, 0);
    const raw = Buffer.from(buf.subarray(p, p + size));
    const crc = raw.readUInt32LE(22);
    raw.writeUInt32LE(0, 22);
    assert.equal(oggCrc(raw), crc, "CRC страницы");
    const packets = [];
    let at = p + 27 + n;
    let cur = [];
    for (const l of lacing) {
      cur.push(buf.subarray(at, at + l));
      at += l;
      if (l < 255) {
        packets.push(Buffer.concat(cur));
        cur = [];
      }
    }
    pages.push({ flags: buf[p + 5], granule: Number(buf.readBigInt64LE(p + 6)), sequence: buf.readUInt32LE(p + 18), packets });
    p += size;
  }
  return pages;
}

test("Ogg Opus from afconvert CAF: OpusHead with pre-skip, packets unchanged, end trimmed by the last granule", () => {
  // 300 пакетов по 960 отсчётов, один длиной 300 байт (два сегмента) — страниц больше одной.
  const packets = Array.from({ length: 300 }, (_, i) => Buffer.alloc(i === 7 ? 300 : 40 + (i % 50), i % 256));
  const ogg = cafOpusToOgg(caf({ packets, priming: 312, valid: 300 * 960 - 312 - 500 }), { serial: 0xabcdef01 });
  assert.ok(isOggOpus(ogg));
  const pages = oggPages(ogg);
  assert.deepEqual(pages.map((p) => p.sequence), pages.map((_, i) => i));
  assert.equal(pages[0].flags, 0x02);
  assert.equal(pages.at(-1).flags, 0x04);
  assert.ok(pages.slice(1, -1).every((p) => p.flags === 0));
  const head = pages[0].packets[0];
  assert.equal(head.toString("ascii", 0, 8), "OpusHead");
  assert.equal(head[9], 1);
  assert.equal(head.readUInt16LE(10), 312);
  assert.equal(pages[1].packets[0].toString("ascii", 0, 8), "OpusTags");
  const audio = pages.slice(2);
  assert.ok(audio.length > 1);
  assert.deepEqual(Buffer.concat(audio.flatMap((p) => p.packets)), Buffer.concat(packets));
  let samples = 0;
  for (const p of audio.slice(0, -1)) {
    samples += p.packets.length * 960;
    assert.equal(p.granule, samples);
  }
  assert.equal(audio.at(-1).granule, 300 * 960 - 500);
});

test("Ogg Opus: only Opus CAF at 48 kHz is accepted", () => {
  const bad = caf({ packets: [Buffer.alloc(10)], priming: 312, valid: 100 });
  bad.write("aac ", 8 + 12 + 8, "ascii");
  assert.throws(() => cafOpusToOgg(bad), /кодек/);
});

test("audio urls are collected at any depth, once", () => {
  const data = { a: { ba: "x", audio: { url: "u1" } }, list: [{ audio: { url: "u2" } }, { nested: { audio: { url: "u1" } } }] };
  assert.deepEqual([...audioUrls(data)].sort(), ["u1", "u2"]);
});

test("clip id: the first 16 hex of SHA-256 of the copy in content/audio (the API import uses the same rule)", () => {
  const clips = collectClips();
  assert.ok(clips.length > 0);
  for (const c of clips) assert.match(c.id, /^[0-9a-f]{16}$/);
  assert.equal(new Set(clips.map((c) => c.id)).size, clips.length);
});

test("apps/web/public/audio is up to date with content/audio (m4a and ogg for every recording)", () => {
  assert.deepEqual(check(), []);
});
