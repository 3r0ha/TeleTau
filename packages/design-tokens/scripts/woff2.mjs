// TTF → WOFF2 без внешних инструментов: ~460 КБ TTF при первой загрузке — много для медленного сельского интернета.
// Кодировщик по спецификации W3C WOFF2 (https://www.w3.org/TR/WOFF2/) с «нулевыми» преобразованиями таблиц:
// glyf/loca — версия 3, остальные — версия 0; данные всех таблиц — одним потоком Brotli (zlib Node.js, режим font).
// Без преобразования glyf файл чуть больше, чем у эталонного woff2_compress, но всё равно примерно вдвое меньше TTF.
// Вывод детерминирован (те же байты при тех же входных), поэтому --check сравнивает его с сохранёнными файлами.
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

/** Известные теги таблиц WOFF2 (§ 5.2, Table 4): индекс вместо 4 байт тега. */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/** UIntBase128 (§ 4.1): 7 бит на байт, старший бит — «дальше есть ещё». */
function base128(value) {
  const out = [value & 0x7f];
  for (let v = value >>> 7; v > 0; v >>>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
}

const round4 = (n) => (n + 3) & ~3;

/** Один TrueType-шрифт (sfnt) → WOFF2. */
export function ttfToWoff2(ttf) {
  const flavor = ttf.readUInt32BE(0);
  const numTables = ttf.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.push({ tag: ttf.toString("latin1", o, o + 4), offset: ttf.readUInt32BE(o + 8), length: ttf.readUInt32BE(o + 12) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const directory = [];
  for (const t of tables) {
    const known = KNOWN_TAGS.indexOf(t.tag);
    // Версия преобразования: glyf и loca — 3 («без преобразования»), остальные — 0 (тоже без преобразования).
    const version = t.tag === "glyf" || t.tag === "loca" ? 3 : 0;
    directory.push((version << 6) | (known >= 0 ? known : 63));
    if (known < 0) directory.push(...Buffer.from(t.tag, "latin1"));
    directory.push(...base128(t.length));
  }

  const data = Buffer.concat(tables.map((t) => ttf.subarray(t.offset, t.offset + t.length)));
  const compressed = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });

  const headerSize = 48;
  const compressedOffset = headerSize + directory.length;
  const length = round4(compressedOffset + compressed.length);
  const totalSfntSize = 12 + 16 * numTables + tables.reduce((sum, t) => sum + round4(t.length), 0);
  const head = tables.find((t) => t.tag === "head");
  const revision = head ? ttf.readUInt32BE(head.offset + 4) : 0x00010000; // head.fontRevision (Fixed 16.16)

  const out = Buffer.alloc(length);
  out.write("wOF2", 0, "latin1");
  out.writeUInt32BE(flavor, 4);
  out.writeUInt32BE(length, 8);
  out.writeUInt16BE(numTables, 12);
  out.writeUInt16BE(0, 14);
  out.writeUInt32BE(totalSfntSize, 16);
  out.writeUInt32BE(compressed.length, 20);
  out.writeUInt16BE(revision >>> 16, 24);
  out.writeUInt16BE(Math.round(((revision & 0xffff) / 0x10000) * 1000) & 0xffff, 26);
  // metaOffset, metaLength, metaOrigLength, privOffset, privLength — нули (байты 28–47)
  Buffer.from(directory).copy(out, headerSize);
  compressed.copy(out, compressedOffset);
  return out;
}

/** Таблицы sfnt: тег → байты (для сравнения WOFF2 с исходным TTF). */
export function sfntTables(ttf) {
  const tables = new Map();
  const numTables = ttf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const offset = ttf.readUInt32BE(o + 8);
    tables.set(ttf.toString("latin1", o, o + 4), ttf.subarray(offset, offset + ttf.readUInt32BE(o + 12)));
  }
  return tables;
}

/**
 * Таблицы из WOFF2 этого кодировщика (только «нулевые» преобразования). Для --check: файл годен, если таблицы те же,
 * что в TTF, — побайтное сравнение самих WOFF2 зависело бы от версии Brotli в Node.js.
 */
export function woff2Tables(woff2) {
  if (woff2.toString("latin1", 0, 4) !== "wOF2") throw new Error("не WOFF2");
  if (woff2.readUInt32BE(8) !== woff2.length) throw new Error("WOFF2: поле length не равно размеру файла");
  const numTables = woff2.readUInt16BE(12);
  const compressedLength = woff2.readUInt32BE(20);
  let p = 48;
  const readBase128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = woff2[p++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error("WOFF2: неверный UIntBase128");
  };
  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const flags = woff2[p++];
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag = KNOWN_TAGS[index];
    if (index === 63) {
      tag = woff2.toString("latin1", p, p + 4);
      p += 4;
    }
    const length = readBase128();
    const nullTransform = tag === "glyf" || tag === "loca" ? version === 3 : version === 0;
    if (!nullTransform) throw new Error(`WOFF2: таблица ${tag} с преобразованием — не поддерживается`);
    entries.push({ tag, length });
  }
  const data = brotliDecompressSync(woff2.subarray(p, p + compressedLength));
  const tables = new Map();
  let offset = 0;
  for (const e of entries) {
    tables.set(e.tag, data.subarray(offset, offset + e.length));
    offset += e.length;
  }
  if (offset !== data.length) throw new Error("WOFF2: длины таблиц не сходятся с потоком данных");
  return tables;
}

/** WOFF2 содержит ровно те же таблицы, что TTF. */
export function woff2MatchesTtf(woff2, ttf) {
  const a = sfntTables(ttf);
  const b = woff2Tables(woff2);
  if (a.size !== b.size) return false;
  for (const [tag, bytes] of a) if (!b.get(tag)?.equals(bytes)) return false;
  return true;
}
