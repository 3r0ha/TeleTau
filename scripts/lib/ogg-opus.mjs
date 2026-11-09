// Ogg Opus (RFC 7845) из CAF с Opus, который пишет afconvert macOS: сам afconvert контейнер Ogg не пишет.
// Пакеты Opus переносятся как есть, без перекодирования: CAF (desc, pakt, data) → страницы Ogg с OpusHead и OpusTags.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** CRC-32 страницы Ogg: многочлен 0x04C11DB7, старший бит первым, начальное значение 0, без финального XOR. */
export function oggCrc(bytes) {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** Число переменной длины таблицы пакетов CAF: по 7 бит, старший бит — «дальше ещё байт». */
function readVarint(buf, pos) {
  let v = 0;
  for (;;) {
    const b = buf[pos.at++];
    if (b === undefined) throw new Error("CAF: таблица пакетов обрывается");
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
}

/** Пакеты Opus и их длительности из CAF. */
export function readCafOpus(caf) {
  if (caf.toString("ascii", 0, 4) !== "caff") throw new Error("CAF: нет сигнатуры caff");
  let desc;
  let pakt;
  let data;
  for (let p = 8; p + 12 <= caf.length; ) {
    const type = caf.toString("ascii", p, p + 4);
    const declared = caf.readBigInt64BE(p + 4);
    const size = declared < 0n ? caf.length - p - 12 : Number(declared);
    const body = caf.subarray(p + 12, p + 12 + size);
    if (type === "desc") desc = body;
    else if (type === "pakt") pakt = body;
    else if (type === "data") data = body.subarray(4);
    p += 12 + size;
  }
  if (!desc || !pakt || !data) throw new Error("CAF: нет desc, pakt или data");
  const sampleRate = desc.readDoubleBE(0);
  const format = desc.toString("ascii", 8, 12);
  const bytesPerPacket = desc.readUInt32BE(16);
  const framesPerPacket = desc.readUInt32BE(20);
  const channels = desc.readUInt32BE(24);
  if (format !== "opus") throw new Error(`CAF: кодек ${format}, ожидался opus`);
  if (sampleRate !== 48000) throw new Error(`CAF: частота ${sampleRate}, у Opus в Ogg — 48000`);
  if (channels < 1 || channels > 2) throw new Error(`CAF: каналов ${channels}, поддерживаются 1 и 2`);
  const count = Number(pakt.readBigInt64BE(0));
  const validFrames = Number(pakt.readBigInt64BE(8));
  const priming = pakt.readInt32BE(16);
  const pos = { at: 24 };
  const packets = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const size = bytesPerPacket || readVarint(pakt, pos);
    const frames = framesPerPacket || readVarint(pakt, pos);
    if (offset + size > data.length) throw new Error("CAF: пакет выходит за данные");
    packets.push({ data: data.subarray(offset, offset + size), frames });
    offset += size;
  }
  return { channels, priming, validFrames, packets };
}

function page({ flags, granule, serial, sequence, packets }) {
  const lacing = [];
  for (const p of packets) {
    for (let n = p.length; ; n -= 255) {
      lacing.push(Math.min(n, 255));
      if (n < 255) break;
    }
  }
  if (lacing.length > 255) throw new Error("Ogg: больше 255 сегментов на странице");
  const head = Buffer.alloc(27 + lacing.length);
  head.write("OggS", 0, "ascii");
  head[4] = 0;
  head[5] = flags;
  head.writeBigInt64LE(BigInt(granule), 6);
  head.writeUInt32LE(serial >>> 0, 14);
  head.writeUInt32LE(sequence, 18);
  head[26] = lacing.length;
  Buffer.from(lacing).copy(head, 27);
  const out = Buffer.concat([head, ...packets]);
  out.writeUInt32LE(oggCrc(out), 22);
  return out;
}

const segments = (n) => Math.floor(n / 255) + 1;

/**
 * Ogg Opus из CAF: OpusHead (pre-skip — priming из pakt), OpusTags, затем пакеты по страницам. Позиция последней
 * страницы — pre-skip + число настоящих отсчётов: хвост добивки декодер отрежет.
 */
export function cafOpusToOgg(caf, { serial = 1, vendor = "teletau" } = {}) {
  const { channels, priming, validFrames, packets } = readCafOpus(caf);
  if (!packets.length) throw new Error("CAF: нет пакетов");
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "ascii");
  opusHead[8] = 1;
  opusHead[9] = channels;
  opusHead.writeUInt16LE(priming, 10);
  opusHead.writeUInt32LE(48000, 12);
  opusHead.writeInt16LE(0, 16);
  opusHead[18] = 0;
  const vendorBytes = Buffer.from(vendor, "utf8");
  const opusTags = Buffer.alloc(8 + 4 + vendorBytes.length + 4);
  opusTags.write("OpusTags", 0, "ascii");
  opusTags.writeUInt32LE(vendorBytes.length, 8);
  vendorBytes.copy(opusTags, 12);
  opusTags.writeUInt32LE(0, 12 + vendorBytes.length);

  const pages = [page({ flags: 0x02, granule: 0, serial, sequence: 0, packets: [opusHead] }), page({ flags: 0, granule: 0, serial, sequence: 1, packets: [opusTags] })];
  const end = priming + validFrames;
  let granule = 0;
  let batch = [];
  let batchSegments = 0;
  const flush = (last) => {
    pages.push(page({ flags: last ? 0x04 : 0, granule: last ? end : granule, serial, sequence: pages.length, packets: batch.map((p) => p.data) }));
    batch = [];
    batchSegments = 0;
  };
  packets.forEach((p, i) => {
    if (batch.length && batchSegments + segments(p.data.length) > 255) flush(false);
    batch.push(p);
    batchSegments += segments(p.data.length);
    granule += p.frames;
    if (i === packets.length - 1) flush(true);
  });
  return Buffer.concat(pages);
}

/** Начало файла — Ogg с OpusHead в первой странице. */
export function isOggOpus(bytes) {
  return bytes.length > 36 && bytes.toString("ascii", 0, 4) === "OggS" && bytes.toString("ascii", 28, 36) === "OpusHead";
}

/** Начало файла — Ogg с заголовком Vorbis в первой странице. */
export function isOggVorbis(bytes) {
  return bytes.length > 35 && bytes.toString("ascii", 0, 4) === "OggS" && bytes[28] === 1 && bytes.toString("ascii", 29, 35) === "vorbis";
}
