// Silero TTS v5 CIS (v5_cis_base_nostress) на чистом JavaScript: веса читаются из исходного пакета модели
// (torch.package, .pt) без PyTorch и без конвертации, сеть повторяет TorchScript-код пакета
// (.data/ts_code/code/__torch__/silero_vocoder/jit_model.py и вложенные модули):
//   текст → символы → длительности и высота тона (трансформеры) → кодировщик FastPitch → регулятор длин →
//   декодер HourGlass → мел-спектр (192) → вокодер Vocos (ConvNeXt + ISTFT, 48 кГц) → PQMF-полоса 0 (24 кГц).
// Тензоры батча 1 хранятся как Float32Array в порядке [время, каналы]; накопление сумм — в double.
import { loadScriptModule, plain, readZip, unpickle } from "./torch-package.mjs";

export const SILERO_MODEL = {
  id: "v5_cis_base_nostress",
  url: "https://models.silero.ai/models/tts/ru/v5_cis_base_nostress.pt",
  sha256: "0405777e332906f0644e08a680f7cfdc2137ea864090079c1fdd30a43c1b8761",
};

const VOCODER_SAMPLE_RATE = 48000;

// --- текст → последовательность символов (multi_acc_v3_package.py: prepare_text_input, preprocess_tacotron)

/** Текст для модели: нижний регистр, тире, только символы модели, пробелы схлопнуты. Без букв — ошибка. */
export function prepareText(text, { symbols, extAlph = {}, lang }) {
  let t = text.trim();
  t = t.replace(/\n/g, (_m, at) => (at > 0 && ",;:.!?".includes(t[at - 1]) ? " " : ". "));
  t = t.toLowerCase().replaceAll("—", "–").replaceAll("‑", "-");
  t = convertToOrig(t, extAlph[lang], symbols);
  const allowed = new Set([...symbols.slice(3), "^"]);
  t = [...t].filter((ch) => allowed.has(ch)).join("");
  t = cleanStarText(t);
  if (!/[а-я-]/.test(t)) throw new Error("в тексте нет букв, которые модель читает");
  return t;
}

/** convert_to_orig: замена внешнего алфавита языка (грузинский, армянский, латиница) на кириллицу модели. */
function convertToOrig(x, table, symbols) {
  x = x.toLowerCase();
  const letters = [...x].filter((ch) => /\p{L}/u.test(ch));
  const alphabet = new Set(symbols);
  if (!letters.length || letters.every((ch) => alphabet.has(ch)) || !table) return x;
  return [...x].map((ch) => table[ch] ?? ch).join("");
}

function cleanStarText(t) {
  t = t.replaceAll("^", " ^").replace(/\s+/g, " ").trim().replaceAll("^ ", "^").replace(/\^+/g, "^").trim();
  if (t.length && t.at(-1) === "^") t = t.slice(0, -1).trim();
  return t;
}

/** Номера символов: «|» + текст + «~» (sos/eos). */
export function encodeText(sentence, { symbolToId, sos, eos }) {
  return Int32Array.from([sos, ...sentence, eos], (ch) => {
    const id = symbolToId[ch];
    if (id === undefined) throw new Error(`символа «${ch}» нет в модели`);
    return id;
  });
}

/** torch.round: половина — к чётному. */
export function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// --- примитивы над [время, каналы]

/** y[t, o] = b[o] + Σ_i x[t, i]·W[o, i]  (nn.Linear; W — [out, in]). */
function linear(x, T, cin, W, b, cout) {
  const y = new Float32Array(T * cout);
  // Четыре строки весов за проход по всем t: они остаются в кеше, вход читается один раз на четыре выхода.
  let o = 0;
  for (; o + 3 < cout; o += 4) {
    const w0 = o * cin, w1 = w0 + cin, w2 = w1 + cin, w3 = w2 + cin;
    const b0 = b ? b[o] : 0, b1 = b ? b[o + 1] : 0, b2 = b ? b[o + 2] : 0, b3 = b ? b[o + 3] : 0;
    let t = 0;
    for (; t + 1 < T; t += 2) {
      const xa = t * cin, xb = xa + cin;
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0, c0 = 0, c1 = 0, c2 = 0, c3 = 0;
      for (let i = 0; i < cin; i++) {
        const u = x[xa + i], v = x[xb + i];
        const q0 = W[w0 + i], q1 = W[w1 + i], q2 = W[w2 + i], q3 = W[w3 + i];
        a0 += u * q0;
        a1 += u * q1;
        a2 += u * q2;
        a3 += u * q3;
        c0 += v * q0;
        c1 += v * q1;
        c2 += v * q2;
        c3 += v * q3;
      }
      const ya = t * cout + o, yb = ya + cout;
      y[ya] = b0 + a0;
      y[ya + 1] = b1 + a1;
      y[ya + 2] = b2 + a2;
      y[ya + 3] = b3 + a3;
      y[yb] = b0 + c0;
      y[yb + 1] = b1 + c1;
      y[yb + 2] = b2 + c2;
      y[yb + 3] = b3 + c3;
    }
    for (; t < T; t++) {
      const xo = t * cin;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let i = 0; i < cin; i++) {
        const v = x[xo + i];
        s0 += v * W[w0 + i];
        s1 += v * W[w1 + i];
        s2 += v * W[w2 + i];
        s3 += v * W[w3 + i];
      }
      const yo = t * cout + o;
      y[yo] = b0 + s0;
      y[yo + 1] = b1 + s1;
      y[yo + 2] = b2 + s2;
      y[yo + 3] = b3 + s3;
    }
  }
  for (; o < cout; o++) {
    const wo = o * cin;
    for (let t = 0; t < T; t++) {
      const xo = t * cin;
      let s = 0;
      for (let i = 0; i < cin; i++) s += x[xo + i] * W[wo + i];
      y[t * cout + o] = (b ? b[o] : 0) + s;
    }
  }
  return y;
}

/** Веса Conv1d [out, in, k] → k матриц [out, in] (для linear по сдвигам). */
function convTaps(w) {
  const [cout, cin, K] = w.shape;
  return Array.from({ length: K }, (_, k) => {
    const m = new Float32Array(cout * cin);
    for (let o = 0; o < cout; o++) for (let i = 0; i < cin; i++) m[o * cin + i] = w.data[(o * cin + i) * K + k];
    return m;
  });
}

/** Conv1d, шаг 1, нули по краям: y[t] = b + Σ_k W_k·x[t + k − pad]. */
function conv1d(x, T, cin, taps, b, cout, pad) {
  const y = new Float32Array(T * cout);
  const acc = new Float64Array(T * cout);
  for (let k = 0; k < taps.length; k++) {
    const shift = k - pad;
    const lo = Math.max(0, -shift);
    const hi = Math.min(T, T - shift);
    if (hi <= lo) continue;
    const part = linear(x.subarray((lo + shift) * cin, (hi + shift) * cin), hi - lo, cin, taps[k], null, cout);
    for (let j = 0; j < part.length; j++) acc[lo * cout + j] += part[j];
  }
  for (let j = 0; j < y.length; j++) y[j] = acc[j] + (b ? b[j % cout] : 0);
  return y;
}

/** Поканальная свёртка (groups = каналы), ядро [c, 1, k]. */
function depthwiseConv1d(x, T, C, w, b, pad) {
  const K = w.shape[2];
  const y = new Float32Array(T * C);
  for (let t = 0; t < T; t++)
    for (let c = 0; c < C; c++) {
      let s = b[c];
      for (let k = 0; k < K; k++) {
        const tt = t + k - pad;
        if (tt >= 0 && tt < T) s += x[tt * C + c] * w.data[c * K + k];
      }
      y[t * C + c] = s;
    }
  return y;
}

function layerNorm(x, T, C, w, b, eps) {
  const y = new Float32Array(T * C);
  for (let t = 0; t < T; t++) {
    const o = t * C;
    let mean = 0;
    for (let c = 0; c < C; c++) mean += x[o + c];
    mean /= C;
    let v = 0;
    for (let c = 0; c < C; c++) v += (x[o + c] - mean) ** 2;
    const inv = 1 / Math.sqrt(v / C + eps);
    for (let c = 0; c < C; c++) y[o + c] = (x[o + c] - mean) * inv * w[c] + b[c];
  }
  return y;
}

function addInPlace(a, b) {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
  return a;
}

/** erf с точностью double (fdlibm s_erf.c). */
export function erf(x) {
  const ax = Math.abs(x);
  const sign = x < 0 ? -1 : 1;
  if (ax < 0.84375) {
    if (ax < 2 ** -28) return x * (1 + 0.128379167095512558561);
    const z = x * x;
    const r = 1.28379167095512558561e-1 + z * (-3.25042107247001499370e-1 + z * (-2.84817495755985104766e-2 + z * (-5.77027029648944159157e-3 + z * -2.37630166566501626084e-5)));
    const s = 1 + z * (3.97917223959155352819e-1 + z * (6.50222499887672944485e-2 + z * (5.08130628187576562776e-3 + z * (1.32494738004321644526e-4 + z * -3.96022827877536812320e-6))));
    return x + x * (r / s);
  }
  if (ax < 1.25) {
    const s = ax - 1;
    const P = -2.36211856075265944077e-3 + s * (4.14856118683748331666e-1 + s * (-3.72207876035701323847e-1 + s * (3.18346619901161753674e-1 + s * (-1.10894694282396677476e-1 + s * (3.54783043256182359371e-2 + s * -2.16637559486879084300e-3)))));
    const Q = 1 + s * (1.06420880400844228286e-1 + s * (5.40397917702171048937e-1 + s * (7.18286544141962662868e-2 + s * (1.26171219808761642112e-1 + s * (1.36370839120290507362e-2 + s * 1.19844998467991074170e-2)))));
    return sign * (8.45062911510467529297e-1 + P / Q);
  }
  if (ax >= 6) return sign * (1 - 1e-300);
  const s = 1 / (ax * ax);
  let R, S;
  if (ax < 1 / 0.35) {
    R = -9.86494403484714822705e-3 + s * (-6.93858572707181764372e-1 + s * (-1.05586262253232909814e1 + s * (-6.23753324503260060396e1 + s * (-1.62396669462573470355e2 + s * (-1.84605092906711035994e2 + s * (-8.12874355063065934246e1 + s * -9.81432934416914548592))))));
    S = 1 + s * (1.96512716674392571292e1 + s * (1.37657754143519042600e2 + s * (4.34565877475229228821e2 + s * (6.45387271733267880336e2 + s * (4.29008140027567833386e2 + s * (1.08635005541779435134e2 + s * (6.57024977031928170135 + s * -6.04244152148580987438e-2)))))));
  } else {
    R = -9.86494292470009928597e-3 + s * (-7.99283237680523006574e-1 + s * (-1.77579549177547519889e1 + s * (-1.60636384855821916062e2 + s * (-6.37566443368389627722e2 + s * (-1.02509513161107724954e3 + s * -4.83519191608651397019e2)))));
    S = 1 + s * (3.03380607434824582924e1 + s * (3.25792512996573918826e2 + s * (1.53672958608443695994e3 + s * (3.19985821950859553908e3 + s * (2.55305040643316442583e3 + s * (4.74528541206955367215e2 + s * -2.24409524465858183362e1))))));
  }
  // z — ax с обнулёнными младшими 32 битами мантиссы, как в fdlibm
  const f = new Float64Array([ax]);
  new Uint32Array(f.buffer)[0] = 0;
  const z = f[0];
  const r = Math.exp(-z * z - 0.5625) * Math.exp((z - ax) * (z + ax) + R / S);
  return sign * (1 - r / ax);
}

const twiddleCache = new Map();

/** exp(2πi·j/n), j = 0…n−1. */
function twiddles(n) {
  let tw = twiddleCache.get(n);
  if (!tw) {
    tw = { cos: new Float64Array(n), sin: new Float64Array(n) };
    for (let j = 0; j < n; j++) {
      tw.cos[j] = Math.cos((2 * Math.PI * j) / n);
      tw.sin[j] = Math.sin((2 * Math.PI * j) / n);
    }
    twiddleCache.set(n, tw);
  }
  return tw;
}

/** Комплексное ДПФ произвольной длины: Кули — Тьюки со смешанным основанием; sign — знак показателя. */
export function fft(re, im, sign) {
  const n = re.length;
  const tw = twiddles(n);
  const rec = (offset, stride, len) => {
    if (len === 1) return [Float64Array.of(re[offset]), Float64Array.of(im[offset])];
    let p = 2;
    while (len % p) p++;
    const m = len / p;
    const subs = Array.from({ length: p }, (_, r) => rec(offset + r * stride, stride * p, m));
    const outR = new Float64Array(len);
    const outI = new Float64Array(len);
    const step = n / len; // угол 2π·r·k/len = 2π·(r·k·step)/n
    for (let k = 0; k < len; k++) {
      const km = k % m;
      let sr = 0, si = 0;
      for (let r = 0; r < p; r++) {
        const j = (r * k * step) % n;
        const c = tw.cos[j], s = sign * tw.sin[j];
        const yr = subs[r][0][km], yi = subs[r][1][km];
        sr += yr * c - yi * s;
        si += yr * s + yi * c;
      }
      outR[k] = sr;
      outI[k] = si;
    }
    return [outR, outI];
  };
  return rec(0, 1, n);
}

/** torch.fft.irfft(n, norm="backward"): мнимые части нулевой и найквистовой частот отбрасываются. */
export function irfft(specRe, specIm, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const half = n >> 1;
  for (let k = 0; k <= half; k++) {
    re[k] = specRe[k];
    im[k] = k === 0 || (k === half && n % 2 === 0) ? 0 : specIm[k];
    if (k > 0 && k < n - k) {
      re[n - k] = re[k];
      im[n - k] = -im[k];
    }
  }
  const [out] = fft(re, im, +1);
  for (let i = 0; i < n; i++) out[i] /= n;
  return out;
}

// --- модель

export class SileroTTS {
  /** pkg — путь к .pt или Buffer с ним. */
  constructor(pkg) {
    const zip = readZip(pkg);
    const root = zip.names[0].split("/")[0];
    const cfg = plain(unpickle(zip.read(`${root}/tts_models/model`)));
    const part = cfg.packages[0];
    if (part.phons || part.accentor) throw new Error("пакет модели не того вида: ожидается v5_cis_base_nostress");
    this.symbols = part.symbols;
    this.symbolToId = part.symbol_to_id;
    this.sos = part.sos_token;
    this.eos = part.eos_token;
    this.extAlph = part.ext_alph ?? {};
    this.speakerIds = part.speaker_to_ids[0];
    this.net = loadScriptModule(zip, `${root}/.data/ts_code/0`, (key) => `${root}/.data/${key}`);
    if (this.net.type !== "MultiTTSModel") throw new Error(`неожиданный модуль ${this.net.type}`);
    this.prep = new WeakMap();
  }

  get speakers() {
    return Object.keys(this.speakerIds);
  }

  /** Синтез: Float32Array PCM [-1, 1] с частотой sampleRate (24000 или 48000). */
  synthesize(text, { speaker = "bak_aigul", sampleRate = 24000 } = {}) {
    const spk = this.speakerIds[speaker];
    if (spk === undefined) throw new Error(`диктора ${speaker} нет в модели`);
    if (sampleRate !== 24000 && sampleRate !== VOCODER_SAMPLE_RATE) throw new Error("частота: 24000 или 48000");
    const lang = Object.keys(this.extAlph).length ? speaker.split("_")[0] : undefined;
    const sentence = prepareText(text, { symbols: this.symbols, extAlph: this.extAlph, lang });
    const ids = encodeText(sentence, { symbolToId: this.symbolToId, sos: this.sos, eos: this.eos });
    const durs = this.durations(ids, spk);
    const pitch = this.pitch(ids, spk);
    const mel = this.acoustic(ids, spk, durs, pitch);
    const frames = durs.reduce((a, b) => a + b, 0);
    const audio = this.vocoder(mel, frames);
    return sampleRate === 24000 ? this.pqmfBand0(audio, this.net.vocoder.pqmf_2) : audio;
  }

  /** Длительности символов в кадрах (12,5 мс): MultiTTSModel.forward без SSML и пауз. */
  durations(ids, spk) {
    const logDur = this.seriesPredictor(this.net.dur_predictor.dur_pred, ids, spk);
    const d = Array.from(logDur, (v) => roundHalfEven(Math.max(0, Math.fround(Math.fround(Math.exp(v)) - 1))));
    const L = d.length;
    if (d[0] > 5) d[0] = 5;
    if (d[L - 1] > 7) d[L - 1] = 7;
    d[L - 2] = 13;
    if (d[L - 3] > 13) d[L - 3] = 13;
    return d;
  }

  /** Высота тона на символ (нормированная); |p| < 0,001 → 0 (update_pitch_coef с коэффициентом 1). */
  pitch(ids, spk) {
    const p = this.seriesPredictor(this.net.pitch_predictor.pitch_pred, ids, spk);
    for (let i = 0; i < p.length; i++) if (Math.abs(p[i]) < 0.001) p[i] = 0;
    return p;
  }

  /** TransformerSeriesPredictor: эмбеддинг + диктор → трансформер → Linear(d, 1). */
  seriesPredictor(m, ids, spk) {
    const D = m.embedding.weight.shape[1];
    const x = this.embed(m.embedding.weight, ids);
    const s = m.speaker_embedding.weight.data.subarray(spk * D, (spk + 1) * D);
    for (let t = 0; t < ids.length; t++) for (let c = 0; c < D; c++) x[t * D + c] += s[c];
    const h = this.transformer(m.transformer, x, ids.length);
    return linear(h, ids.length, D, m.lin.weight.data, m.lin.bias.data, 1);
  }

  /** JitMultiForward: кодировщик + диктор + проекция тона → регулятор длин → декодер → мел [кадры, 192]. */
  acoustic(ids, spk, durs, pitch) {
    const m = this.net.tacotron;
    const L = ids.length;
    const D = m.embedding.weight.shape[1];
    const enc = this.transformer(m.encoder, this.embed(m.embedding.weight, ids), L);
    const s = m.speaker_embedding.weight.data.subarray(spk * D, (spk + 1) * D);
    const pp = conv1d(pitch, L, 1, this.taps(m.pitch_proj.weight), m.pitch_proj.bias.data, D, 1);
    for (let t = 0; t < L; t++)
      for (let c = 0; c < D; c++) enc[t * D + c] += s[c] + pp[t * D + c] * m.pitch_strength;
    const frames = durs.reduce((a, b) => a + b, 0);
    const exp = new Float32Array(frames * D);
    for (let t = 0, f = 0; t < L; t++)
      for (let r = 0; r < durs[t]; r++, f++) exp.set(enc.subarray(t * D, (t + 1) * D), f * D);
    const dec = this.hourglass(m.decoder, exp, frames, D);
    return linear(dec, frames, D, m.lin.weight.data, m.lin.bias.data, m.lin.weight.shape[0]);
  }

  embed(w, ids) {
    const D = w.shape[1];
    const x = new Float32Array(ids.length * D);
    for (let t = 0; t < ids.length; t++) x.set(w.data.subarray(ids[t] * D, (ids[t] + 1) * D), t * D);
    return x;
  }

  posEncode(pe, x, T, D) {
    const scale = pe.scale.data[0];
    const table = pe.pe.data;
    for (let t = 0; t < T; t++) for (let c = 0; c < D; c++) x[t * D + c] += scale * table[t * D + c];
    return x;
  }

  /** ForwardTransformer: позиции → 4 блока FFT → LayerNorm. */
  transformer(m, x, T) {
    const D = m.d_model;
    let h = this.posEncode(m.pos_encoder, x, T, D);
    for (const block of Object.values(m.layers).filter((v) => v && v.type)) h = this.fftBlock(block, h, T, D);
    return layerNorm(h, T, D, m.norm.weight.data, m.norm.bias.data, 1e-5);
  }

  /** HourGlassTransformer: блок → сжатие ×3 (AvgPool) → блок → Linear-расширение + остаток → блок → LayerNorm. */
  hourglass(m, x, L, D) {
    const k = m.shorten_factor;
    let h = this.posEncode(m.pos_encoder, x, L, D);
    h = this.fftBlock(m.pre_vanilla_layers["0"], h, L, D);
    const Lp = Math.ceil(L / k) * k;
    const padded = new Float32Array(Lp * D);
    padded.set(h);
    const Ls = Lp / k;
    const down = new Float32Array(Ls * D);
    for (let i = 0; i < Ls; i++)
      for (let c = 0; c < D; c++) {
        let s = 0;
        for (let j = 0; j < k; j++) s += padded[(i * k + j) * D + c];
        down[i * D + c] = s / k;
      }
    // В TorchScript пакета результат shorten_layers[0] не используется: дальше идёт только shorten_layers[1].
    const short = this.fftBlock(m.shorten_layers["1"], down, Ls, D);
    const up = linear(short, Ls, D, m.upsample.proj.weight.data, m.upsample.proj.bias.data, D * k);
    addInPlace(up, padded);
    h = this.fftBlock(m.post_vanilla_layers["0"], up.subarray(0, L * D), L, D);
    return layerNorm(h, L, D, m.norm.weight.data, m.norm.bias.data, 1e-5);
  }

  /** FFTBlock: LN(x + MHA(x)) → LN(x + Conv1d(ReLU(Conv1d(x)))). */
  fftBlock(m, x, T, D) {
    const a = this.attention(m.self_attn, x, T, D);
    const h = layerNorm(addInPlace(a, x), T, D, m.norm1.weight.data, m.norm1.bias.data, 1e-5);
    const hidden = m.conv1.weight.shape[0];
    const pad = (m.conv1.weight.shape[2] - 1) / 2;
    const c1 = conv1d(h, T, D, this.taps(m.conv1.weight), m.conv1.bias.data, hidden, pad);
    for (let i = 0; i < c1.length; i++) if (c1[i] < 0) c1[i] = 0;
    const c2 = conv1d(c1, T, hidden, this.taps(m.conv2.weight), m.conv2.bias.data, D, 0);
    return layerNorm(addInPlace(c2, h), T, D, m.norm2.weight.data, m.norm2.bias.data, 1e-5);
  }

  /** nn.MultiheadAttention (batch_first, без масок: в последовательности нет символа-заполнителя). */
  attention(m, x, T, D) {
    const H = m.num_heads;
    const hd = D / H;
    const qkv = linear(x, T, D, m.in_proj_weight.data, m.in_proj_bias.data, 3 * D);
    const ctx = new Float32Array(T * D);
    const scale = 1 / Math.sqrt(hd);
    const w = new Float64Array(T);
    for (let h = 0; h < H; h++)
      for (let i = 0; i < T; i++) {
        const q = i * 3 * D + h * hd;
        let max = -Infinity;
        for (let j = 0; j < T; j++) {
          const k = j * 3 * D + D + h * hd;
          let s = 0;
          for (let c = 0; c < hd; c++) s += qkv[q + c] * qkv[k + c];
          w[j] = s * scale;
          if (w[j] > max) max = w[j];
        }
        let sum = 0;
        for (let j = 0; j < T; j++) sum += w[j] = Math.exp(w[j] - max);
        for (let c = 0; c < hd; c++) {
          let s = 0;
          for (let j = 0; j < T; j++) s += w[j] * qkv[j * 3 * D + 2 * D + h * hd + c];
          ctx[i * D + h * hd + c] = s / sum;
        }
      }
    return linear(ctx, T, D, m.out_proj.weight.data, m.out_proj.bias.data, D);
  }

  /** Вокодер Vocos: Conv1d → LN → 8 ConvNeXt → LN → Linear → амплитуда и фаза → ISTFT («same»), 48 кГц. */
  vocoder(mel, T) {
    const { backbone, head } = this.net.vocoder;
    const C = backbone.embed.weight.shape[0];
    const cin = backbone.embed.weight.shape[1];
    let x = conv1d(mel, T, cin, this.taps(backbone.embed.weight), backbone.embed.bias.data, C, 3);
    x = layerNorm(x, T, C, backbone.norm.weight.data, backbone.norm.bias.data, 1e-6);
    for (const blk of Object.values(backbone.convnext).filter((v) => v && v.type)) {
      let y = depthwiseConv1d(x, T, C, blk.dwconv.weight, blk.dwconv.bias.data, 3);
      y = layerNorm(y, T, C, blk.norm.weight.data, blk.norm.bias.data, 1e-6);
      const hidden = blk.pwconv1.weight.shape[0];
      y = linear(y, T, C, blk.pwconv1.weight.data, blk.pwconv1.bias.data, hidden);
      for (let i = 0; i < y.length; i++) y[i] = 0.5 * y[i] * (1 + erf(y[i] / Math.SQRT2));
      y = linear(y, T, hidden, blk.pwconv2.weight.data, blk.pwconv2.bias.data, C);
      const g = blk.gamma.data;
      for (let i = 0; i < y.length; i++) x[i] += g[i % C] * y[i];
    }
    x = layerNorm(x, T, C, backbone.final_layer_norm.weight.data, backbone.final_layer_norm.bias.data, 1e-6);
    const bins = head.out.weight.shape[0] / 2;
    const spec = linear(x, T, C, head.out.weight.data, head.out.bias.data, 2 * bins);
    return this.istft(spec, T, bins, head.istft);
  }

  /** ISTFT с padding="same": irfft кадра × окно, наложение со сдвигом hop, деление на огибающую окна². */
  istft(spec, T, bins, cfg) {
    const { n_fft: n, hop_length: hop, win_length: win } = cfg;
    const window = cfg.window.data;
    const pad = (win - hop) >> 1;
    const size = (T - 1) * hop + win;
    const y = new Float64Array(size);
    const env = new Float64Array(size);
    const re = new Float64Array(bins);
    const im = new Float64Array(bins);
    for (let t = 0; t < T; t++) {
      const o = t * 2 * bins;
      for (let k = 0; k < bins; k++) {
        const mag = Math.min(Math.fround(Math.exp(spec[o + k])), 100);
        const ph = spec[o + bins + k];
        re[k] = mag * Math.cos(ph);
        im[k] = mag * Math.sin(ph);
      }
      const frame = irfft(re, im, n);
      for (let i = 0; i < win; i++) {
        y[t * hop + i] += frame[i] * window[i];
        env[t * hop + i] += window[i] * window[i];
      }
    }
    const out = new Float32Array(size - 2 * pad);
    for (let i = 0; i < out.length; i++) {
      if (!(env[i + pad] > 1e-11)) throw new Error("ISTFT: нулевая огибающая окна");
      out[i] = y[i + pad] / env[i + pad];
    }
    return out;
  }

  /** PQMF.analysis (stride N, padding taps/2) → полоса 0; tanh, если |x| > 1 в какой-либо полосе. */
  pqmfBand0(x, pqmf) {
    const [N, , K] = pqmf.H.shape;
    const H = pqmf.H.data;
    const pad = pqmf.taps >> 1;
    const len = Math.floor((x.length + 2 * pad - K) / N) + 1;
    const bands = Array.from({ length: N }, () => new Float64Array(len));
    let peak = 0;
    for (let b = 0; b < N; b++)
      for (let j = 0; j < len; j++) {
        let s = 0;
        for (let k = 0; k < K; k++) {
          const i = j * N + k - pad;
          if (i >= 0 && i < x.length) s += H[b * K + k] * x[i];
        }
        bands[b][j] = Math.fround(s);
        peak = Math.max(peak, Math.abs(bands[b][j]));
      }
    return Float32Array.from(bands[0], (v) => (peak <= 1 ? v : Math.tanh(v)));
  }

  taps(w) {
    let t = this.prep.get(w);
    if (!t) this.prep.set(w, (t = convTaps(w)));
    return t;
  }
}
