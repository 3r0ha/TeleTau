// Генератор синтезированной озвучки (scripts/tts): чтение архива PyTorch, текстовый фронтенд Silero,
// численные примитивы и формат файлов, который ждёт конвейер (Ogg Vorbis 24 кГц, моно).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isOggVorbis } from "../lib/ogg-opus.mjs";
import { encodeVorbis, modelPath, SAMPLE_RATE } from "../tts/generate.mjs";
import { encodeText, erf, fft, irfft, prepareText, roundHalfEven, SileroTTS } from "../tts/silero.mjs";
import { loadScriptModule, readZip, unpickle } from "../tts/torch-package.mjs";

const REPO = join(import.meta.dirname, "../..");
const TTS_DIR = join(REPO, "content/audio/tts");

// Таблица символов пакета v5_cis_base_nostress (tts_models/model → symbols, symbol_to_id).
const SYMBOLS = "|!'+,-.:;?hабвгдежзийклмнопрстуфхцчшщъыьэюяёєіїјўґғҕҗҙқҝҡңҥҫүұҳҷҹһӑӗәӝӟӣӥӧөӯӱӳӵӏ—… ";
const SYMBOL_TO_ID = Object.fromEntries(["_", "~", ...SYMBOLS].map((s, i) => [s, i]));

/** Ogg-страница 0: заголовок идентификации Vorbis. */
function vorbisId(ogg) {
  const id = ogg.subarray(27 + ogg[26]);
  return { channels: id[11], rate: id.readUInt32LE(12), nominal: id.readInt32LE(20) };
}

/** Последняя гранула Ogg — число сэмплов в файле. */
function lastGranule(ogg) {
  let granule = 0n;
  for (let p = 0; p + 27 <= ogg.length; ) {
    const segs = ogg[p + 26];
    let len = 0;
    for (let i = 0; i < segs; i++) len += ogg[p + 27 + i];
    granule = ogg.readBigInt64LE(p + 6);
    p += 27 + segs + len;
  }
  return Number(granule);
}

/** Zip без сжатия (stored), как пишет torch.save. */
function storedZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Опкоды pickle для сборки тестовых данных.
const P = {
  str: (s) => {
    const b = Buffer.from(s);
    const h = Buffer.alloc(5);
    h[0] = 0x58;
    h.writeUInt32LE(b.length, 1);
    return Buffer.concat([h, b]);
  },
  int: (n) => Buffer.from([0x4b, n]),
  float: (x) => {
    const b = Buffer.alloc(9);
    b[0] = 0x47;
    b.writeDoubleBE(x, 1);
    return b;
  },
  global: (m, n) => Buffer.from(`c${m}\n${n}\n`),
  op: (...codes) => Buffer.from(codes),
};

test("unpickle: dict, list, tuple, memo, floats and objects with BUILD state", () => {
  const data = Buffer.concat([
    P.op(0x80, 2, 0x7d, 0x71, 0, 0x28), // PROTO 2, EMPTY_DICT, BINPUT 0, MARK
    P.str("a"), P.int(1),
    P.str("b"), P.op(0x5d, 0x71, 1, 0x28), P.float(1.5), P.op(0x88, 0x4e, 0x65), // [1.5, True, None]
    P.str("c"), P.int(7), P.int(8), P.op(0x86), // (7, 8)
    P.str("d"), P.op(0x68, 1), // ссылка на тот же список (BINGET 1)
    P.str("e"), P.global("pkg.mod", "Cls"), P.op(0x29, 0x81, 0x7d), P.str("k"), P.str("в"), P.op(0x73, 0x62), // Cls() + {k: "в"}
    P.op(0x75, 0x2e), // SETITEMS, STOP
  ]);
  const d = unpickle(data);
  assert.equal(d.get("a"), 1);
  assert.deepEqual(d.get("b"), [1.5, true, null]);
  assert.deepEqual(d.get("c"), [7, 8]);
  assert.equal(d.get("d"), d.get("b"));
  assert.equal(d.get("e").name, "Cls");
  assert.equal(d.get("e").state.get("k"), "в");
});

test("TorchScript archive: module tree and tensors from storages (offset, strides of size-1 dims, transposed view)", () => {
  const storage = Buffer.from(Float32Array.from([0, 1, 2, 3, 4, 5, 6]).buffer);
  const tensor = (offset, size, stride) =>
    Buffer.concat([
      P.global("torch._utils", "_rebuild_tensor_v2"),
      P.op(0x28), // MARK аргументов
      P.op(0x28), P.str("storage"), P.global("torch", "FloatStorage"), P.str("0"), P.str("cpu"), P.int(7), P.op(0x74, 0x51), // (…) BINPERSID
      P.int(offset),
      P.op(0x28), ...size.map(P.int), P.op(0x74),
      P.op(0x28), ...stride.map(P.int), P.op(0x74),
      P.op(0x89), P.global("collections", "OrderedDict"), P.op(0x29, 0x52), // requires_grad, hooks
      P.op(0x74, 0x52), // TUPLE, REDUCE
    ]);
  const pkl = Buffer.concat([
    P.op(0x80, 2), P.global("__torch__.m", "Lin"), P.op(0x29, 0x81, 0x7d, 0x28),
    P.str("weight"), tensor(1, [2, 3], [3, 1]),
    P.str("pe"), tensor(0, [3, 1, 2], [2, 100, 1]),
    P.str("wt"), tensor(0, [3, 2], [1, 3]),
    P.str("heads"), P.int(2),
    P.op(0x75, 0x62, 0x2e),
  ]);
  const zip = readZip(storedZip({ "m/data.pkl": pkl, "m/data/0": storage }));
  const m = loadScriptModule(zip, "m", (key) => `m/data/${key}`);
  assert.equal(m.type, "Lin");
  assert.equal(m.heads, 2);
  assert.deepEqual(m.weight.shape, [2, 3]);
  assert.deepEqual([...m.weight.data], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...m.pe.data], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...m.wt.data], [0, 3, 1, 4, 2, 5]);
});

test("Silero text front end: lowercase, dashes and «!» dropped, only model symbols; sos/eos ids", () => {
  const opts = { symbols: SYMBOLS };
  assert.equal(prepareText("Ат — кешенең тоғро юлдашы.", opts), "ат кешенең тоғро юлдашы.");
  assert.equal(prepareText("Сәләм, дус!", opts), "сәләм, дус");
  assert.equal(prepareText("  Һин туп уйындарын яратаһыңмы?\n", opts), "һин туп уйындарын яратаһыңмы?");
  assert.equal(prepareText("ике-икең «дүрт»", opts), "ике-икең дүрт");
  assert.throws(() => prepareText("!!! 123", opts), /нет букв/);
  const ids = encodeText("ат", { symbolToId: SYMBOL_TO_ID, sos: "|", eos: "~" });
  assert.deepEqual([...ids], [2, 13, 31, 1]);
});

test("numeric primitives: erf (double precision), mixed-radix FFT, irfft, round half to even", () => {
  const ref = { 0.1: 0.1124629160182849, 0.5: 0.5204998778130465, 1: 0.8427007929497149, 1.5: 0.9661051464753108, 2.5: 0.999593047982555, 4: 0.9999999845827421, "-0.7": -0.6778011938374184 };
  for (const [x, v] of Object.entries(ref)) assert.ok(Math.abs(erf(Number(x)) - v) < 1e-15, `erf(${x})`);
  for (const n of [2400, 30, 7]) {
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + 0.3);
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.7));
    const [R, I] = fft(re, im, -1);
    for (const k of [0, 1, Math.floor(n / 3), n - 1]) {
      let sr = 0, si = 0;
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        sr += re[t] * Math.cos(a) - im[t] * Math.sin(a);
        si += re[t] * Math.sin(a) + im[t] * Math.cos(a);
      }
      assert.ok(Math.abs(sr - R[k]) < 1e-7 && Math.abs(si - I[k]) < 1e-7, `fft ${n}, k=${k}`);
    }
  }
  const n = 2400;
  const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.01) * Math.cos(i * 0.37));
  const [R, I] = fft(x, new Float64Array(n), -1);
  const y = irfft(R.subarray(0, n / 2 + 1), I.subarray(0, n / 2 + 1), n);
  assert.ok(x.every((v, i) => Math.abs(v - y[i]) < 1e-12), "irfft(rfft(x)) = x");
  assert.deepEqual([0.5, 1.5, 2.5, 2.4, 2.6, -1.5].map(roundHalfEven), [0, 2, 2, 2, 3, -2]);
});

test("generator output is Ogg Vorbis 24 kHz mono with the same encoder settings as content/audio/tts", async () => {
  const pcm = Float32Array.from({ length: SAMPLE_RATE / 2 }, (_, i) => 0.3 * Math.sin(i * 0.05));
  const ogg = await encodeVorbis(pcm);
  assert.ok(isOggVorbis(ogg), "не Ogg Vorbis — content-import отдаёт .ogg как audio/ogg; codecs=\"vorbis\"");
  assert.deepEqual(vorbisId(ogg), { channels: 1, rate: 24000, nominal: 45111 });
  assert.equal(lastGranule(ogg), pcm.length);
  for (const f of readdirSync(TTS_DIR).filter((f) => f.endsWith(".ogg")))
    assert.deepEqual(vorbisId(readFileSync(join(TTS_DIR, f))), { channels: 1, rate: 24000, nominal: 45111 }, f);
});

const model = modelPath();
test("Silero in JS reproduces the course files: same length in samples (model from the local cache)", { skip: !existsSync(model) && `нет ${model} — модель скачивает scripts/tts/generate.mjs` }, () => {
  const tts = new SileroTTS(model);
  for (const [slug, text] of [["ат", "ат"], ["апай", "апай"]]) {
    const pcm = tts.synthesize(text, { speaker: "bak_aigul", sampleRate: SAMPLE_RATE });
    assert.equal(pcm.length, lastGranule(readFileSync(join(TTS_DIR, `${slug}.ogg`))), slug);
  }
});
