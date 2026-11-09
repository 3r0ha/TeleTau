// Shared helpers for the RB directory scripts (districts + schools).
// No dependencies beyond Node.js >= 22 built-ins: fetch, zlib, streams.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

export const DATA_DIR = path.resolve(import.meta.dirname, "..");

/** Working directory for raw downloads. Never inside the repository. */
export function workDir() {
  const dir = process.env.TELETAU_RB_WORKDIR ?? path.join(os.tmpdir(), "teletau-rb-directory");
  fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
  return dir;
}

const UA = "teletau-rb-directory/1.0 (+https://github.com/; educational open-data import)";

function explainTls(err, url) {
  const code = err?.cause?.code ?? "";
  if (/CERT|SIGNATURE|ISSUER/.test(code)) {
    return new Error(
      `${url}: TLS error ${code}. Russian government sites use the Russian Trusted Root CA ` +
        "(Минцифры). Download the root and sub CA certificates (https://gu-st.ru/content/lending/" +
        "russian_trusted_root_ca_pem.crt, …/russian_trusted_sub_ca_pem.crt and " +
        "http://nuc-cdp.digital.gov.ru/cdp/subca_ssl_rsa2024.crt converted to PEM), concatenate them " +
        "into one PEM file outside the repository and run with NODE_EXTRA_CA_CERTS=<that file>. " +
        "Nothing has to be installed system-wide.",
      { cause: err },
    );
  }
  return err;
}

export async function httpFetch(url, init = {}, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "user-agent": UA, ...(init.headers ?? {}) },
      });
      if (res.status >= 500) throw new Error(`${url}: HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = explainTls(err, url);
      if (lastErr !== err) throw lastErr;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function fetchText(url, init) {
  const res = await httpFetch(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

export async function downloadFile(url, dest) {
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const tmp = dest + ".part";
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return {
    url,
    bytes: fs.statSync(dest).size,
    lastModified: res.headers.get("last-modified"),
    contentDisposition: res.headers.get("content-disposition"),
  };
}

// ---------------------------------------------------------------------------
// ZIP (incl. ZIP64) reading: from a local file or from a remote file through HTTP Range requests.
// Only the "stored" (0) and "deflate" (8) methods are supported — enough for ФНС/Рособрнадзор.

function parseCentralDirectory(cd) {
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    let x = p + 46 + nameLen;
    const extraEnd = x + extraLen;
    while (x + 4 <= extraEnd) {
      const id = cd.readUInt16LE(x);
      const len = cd.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        // ZIP64 extra field: only the values saturated in the fixed header are present, in this order.
        if (usize === 0xffffffff) {
          usize = Number(cd.readBigUInt64LE(q));
          q += 8;
        }
        if (csize === 0xffffffff) {
          csize = Number(cd.readBigUInt64LE(q));
          q += 8;
        }
        if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
      }
      x += 4 + len;
    }
    entries.push({ name, method, csize, usize, offset });
    p = extraEnd + commentLen;
  }
  return entries;
}

function locateCentralDirectory(tail) {
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("ZIP: end of central directory not found");
  const result = {
    size: tail.readUInt32LE(eocd + 12),
    offset: tail.readUInt32LE(eocd + 16),
    zip64LocatorOffset: null,
  };
  const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
  if (loc >= 0) result.zip64LocatorOffset = Number(tail.readBigUInt64LE(loc + 8));
  return result;
}

/** Remote ZIP accessed by HTTP Range requests (the 58 GB ГАР archive is never downloaded whole). */
export class RemoteZip {
  constructor(url) {
    this.url = url;
  }
  async range(start, endInclusive) {
    const res = await httpFetch(this.url, { headers: { range: `bytes=${start}-${endInclusive}` } });
    if (res.status !== 206)
      throw new Error(`${this.url}: expected 206 for a Range request, got ${res.status}`);
    return res;
  }
  async entries() {
    const head = await httpFetch(this.url, { method: "HEAD" });
    if (!head.ok) throw new Error(`${this.url}: HTTP ${head.status}`);
    this.size = Number(head.headers.get("content-length"));
    this.lastModified = head.headers.get("last-modified");
    const tailStart = Math.max(0, this.size - 65536);
    const tail = Buffer.from(await (await this.range(tailStart, this.size - 1)).arrayBuffer());
    const cdLoc = locateCentralDirectory(tail);
    if (cdLoc.zip64LocatorOffset !== null) {
      const z = Buffer.from(
        await (
          await this.range(cdLoc.zip64LocatorOffset, cdLoc.zip64LocatorOffset + 55)
        ).arrayBuffer(),
      );
      cdLoc.size = Number(z.readBigUInt64LE(40));
      cdLoc.offset = Number(z.readBigUInt64LE(48));
    }
    const cd = Buffer.from(
      await (await this.range(cdLoc.offset, cdLoc.offset + cdLoc.size - 1)).arrayBuffer(),
    );
    return parseCentralDirectory(cd);
  }
  /** Downloads and inflates one entry into `dest`. */
  async extract(entry, dest) {
    const lh = Buffer.from(await (await this.range(entry.offset, entry.offset + 29)).arrayBuffer());
    if (lh.readUInt32LE(0) !== 0x04034b50)
      throw new Error(`ZIP: bad local header for ${entry.name}`);
    const dataStart = entry.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const res = await this.range(dataStart, dataStart + entry.csize - 1);
    const tmp = dest + ".part";
    const stages = [Readable.fromWeb(res.body)];
    if (entry.method === 8) stages.push(zlib.createInflateRaw());
    else if (entry.method !== 0) throw new Error(`ZIP: unsupported method ${entry.method}`);
    await pipeline(...stages, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
  }
}

/** Local ZIP: returns a readable stream of one entry's uncompressed bytes. */
export function localZipEntries(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailStart = Math.max(0, size - 65536);
    const tail = Buffer.alloc(size - tailStart);
    fs.readSync(fd, tail, 0, tail.length, tailStart);
    const cdLoc = locateCentralDirectory(tail);
    if (cdLoc.zip64LocatorOffset !== null) {
      const z = Buffer.alloc(56);
      fs.readSync(fd, z, 0, 56, cdLoc.zip64LocatorOffset);
      cdLoc.size = Number(z.readBigUInt64LE(40));
      cdLoc.offset = Number(z.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdLoc.size);
    fs.readSync(fd, cd, 0, cdLoc.size, cdLoc.offset);
    return parseCentralDirectory(cd);
  } finally {
    fs.closeSync(fd);
  }
}

export function localZipStream(file, entry) {
  const fd = fs.openSync(file, "r");
  const lh = Buffer.alloc(30);
  fs.readSync(fd, lh, 0, 30, entry.offset);
  fs.closeSync(fd);
  if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP: bad local header for ${entry.name}`);
  const start = entry.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const raw = fs.createReadStream(file, { start, end: start + entry.csize - 1 });
  if (entry.method === 0) return raw;
  if (entry.method === 8) return raw.pipe(zlib.createInflateRaw());
  throw new Error(`ZIP: unsupported method ${entry.method}`);
}

// ---------------------------------------------------------------------------
// Streaming extraction of repeated XML elements (flat enough for our two sources).

/**
 * Yields the raw XML of every `<tag …>…</tag>` or `<tag …/>` element from a byte stream.
 * Elements of the same name must not nest (true for Certificate, OBJECT, PARAM, ITEM).
 */
export async function* xmlElements(stream, tag) {
  const decoder = new TextDecoder("utf-8");
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let pos = 0;
    for (;;) {
      let s = buf.indexOf(open, pos);
      while (s >= 0 && !/[\s>/]/.test(buf[s + open.length] ?? "")) s = buf.indexOf(open, s + 1);
      if (s < 0) {
        pos = Math.max(pos, buf.length - open.length - 1);
        break;
      }
      const gt = buf.indexOf(">", s);
      if (gt < 0) {
        pos = s;
        break;
      }
      if (buf[gt - 1] === "/") {
        yield buf.slice(s, gt + 1);
        pos = gt + 1;
        continue;
      }
      const e = buf.indexOf(close, gt);
      if (e < 0) {
        pos = s;
        break;
      }
      yield buf.slice(s, e + close.length);
      pos = e + close.length;
    }
    buf = buf.slice(pos);
  }
}

export function decodeXml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Text of the first child element `<tag>` (decoded), "" for `<tag/>`, undefined if absent. */
export function childText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (m) return decodeXml(m[1]).trim();
  return xml.includes(`<${tag}/>`) ? "" : undefined;
}

export function attrs(xmlStartTag) {
  const out = {};
  for (const m of xmlStartTag.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g))
    out[m[1]] = decodeXml(m[2]);
  return out;
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180): UTF-8 without BOM, comma separator, CRLF line endings, quotes doubled.

function csvField(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(file, header, rows) {
  const lines = [header.map(csvField).join(",")];
  for (const r of rows) lines.push(header.map((h) => csvField(r[h])).join(","));
  fs.writeFileSync(file, lines.join("\r\n") + "\r\n", "utf8");
}

export function parseCsv(text) {
  const [header, ...body] = parseCsvRecords(text);
  return body.map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ""])));
}

/** Raw RFC 4180 records (arrays of fields), header included. */
export function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let quoted = false;
  const endRecord = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      endRecord();
      i += 2;
      continue;
    } else if (c === "\n") endRecord();
    else field += c;
    i++;
  }
  if (field !== "" || row.length) endRecord();
  return rows;
}

// ---------------------------------------------------------------------------
// Text normalisation for matching Russian place names (never written to the output).

export function normKey(s) {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`„“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses runs of whitespace and trims; keeps the original spelling otherwise. */
export function tidy(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}
