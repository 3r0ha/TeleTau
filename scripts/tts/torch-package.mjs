// Чтение архива модели PyTorch (torch.package / TorchScript — zip с pickle-файлами и сырыми тензорами) без
// PyTorch: zip, распаковщик pickle (протоколы 2–4) и сборка дерева модулей с тензорами Float32Array.
// Код модели (TorchScript) не исполняется — из архива берутся только конфигурация и веса.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** Оглавление zip-архива и чтение записи по имени (stored / deflate, zip64). */
export function readZip(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : readFileSync(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("не zip-архив: нет конца центрального каталога");
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    if (buf.readUInt32LE(eocd - 20) !== 0x07064b50) throw new Error("zip64: нет локатора");
    const rec = Number(buf.readBigUInt64LE(eocd - 12));
    count = Number(buf.readBigUInt64LE(rec + 32));
    cdOffset = Number(buf.readBigUInt64LE(rec + 48));
  }
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: повреждён центральный каталог");
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    for (let x = p + 46 + nameLen, end = x + extraLen; x + 4 <= end; ) {
      const id = buf.readUInt16LE(x);
      const size = buf.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) {
          usize = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (csize === 0xffffffff) {
          csize = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(q));
      }
      x += 4 + size;
    }
    entries.set(name, { method, csize, usize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`в архиве нет ${name}`);
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return inflateRawSync(raw);
      throw new Error(`zip: метод сжатия ${e.method} не поддерживается (${name})`);
    },
  };
}

/** Объект Python-класса из pickle: модуль, имя, аргументы конструктора и состояние (BUILD). */
export class PyObject {
  constructor(module, name, args) {
    this.module = module;
    this.name = name;
    this.args = args;
    this.state = undefined;
  }
}

/**
 * Распаковщик pickle. Глобальные имена разрешает find(module, name) (функция-конструктор или undefined —
 * тогда объект станет PyObject), постоянные ссылки — persistentLoad(pid). Словари — Map, кортежи и списки — массивы.
 */
export function unpickle(data, { find = () => undefined, persistentLoad = (pid) => ({ persistent: pid }) } = {}) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const td = new TextDecoder();
  const stack = [];
  const marks = [];
  const memo = new Map();
  let pos = 0;
  const popMark = () => stack.splice(marks.pop());
  const text = (n) => td.decode(data.subarray(pos, (pos += n)));
  const global = (module, name) => find(module, name) ?? { global: true, module, name };
  const call = (fn, args) => {
    if (typeof fn === "function") return fn(...args);
    if (fn?.global) return new PyObject(fn.module, fn.name, args);
    throw new Error(`pickle: вызов не функции (${String(fn)})`);
  };
  for (;;) {
    const op = data[pos++];
    switch (op) {
      case 0x80: pos++; break; // PROTO
      case 0x95: pos += 8; break; // FRAME
      case 0x2e: return stack.pop(); // STOP
      case 0x28: marks.push(stack.length); break; // MARK
      case 0x29: case 0x5d: stack.push([]); break; // EMPTY_TUPLE, EMPTY_LIST
      case 0x7d: stack.push(new Map()); break; // EMPTY_DICT
      case 0x4e: stack.push(null); break; // NONE
      case 0x88: stack.push(true); break; // NEWTRUE
      case 0x89: stack.push(false); break; // NEWFALSE
      case 0x4b: stack.push(data[pos++]); break; // BININT1
      case 0x4d: stack.push(dv.getUint16(pos, true)); pos += 2; break; // BININT2
      case 0x4a: stack.push(dv.getInt32(pos, true)); pos += 4; break; // BININT
      case 0x8a: { // LONG1
        const n = data[pos++];
        let v = 0n;
        for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(data[pos + i]);
        if (n && data[pos + n - 1] & 0x80) v -= 1n << BigInt(8 * n);
        pos += n;
        stack.push(Number(v));
        break;
      }
      case 0x47: stack.push(dv.getFloat64(pos, false)); pos += 8; break; // BINFLOAT
      case 0x58: case 0x54: { const n = dv.getUint32(pos, true); pos += 4; stack.push(text(n)); break; } // BINUNICODE, BINSTRING
      case 0x8c: case 0x55: stack.push(text(data[pos++])); break; // SHORT_BINUNICODE, SHORT_BINSTRING
      case 0x8d: { const n = Number(dv.getBigUint64(pos, true)); pos += 8; stack.push(text(n)); break; } // BINUNICODE8
      case 0x43: { const n = data[pos++]; stack.push(data.slice(pos, (pos += n))); break; } // SHORT_BINBYTES
      case 0x42: { const n = dv.getUint32(pos, true); pos += 4; stack.push(data.slice(pos, (pos += n))); break; } // BINBYTES
      case 0x71: memo.set(data[pos++], stack.at(-1)); break; // BINPUT
      case 0x72: memo.set(dv.getUint32(pos, true), stack.at(-1)); pos += 4; break; // LONG_BINPUT
      case 0x94: memo.set(memo.size, stack.at(-1)); break; // MEMOIZE
      case 0x68: stack.push(memo.get(data[pos++])); break; // BINGET
      case 0x6a: stack.push(memo.get(dv.getUint32(pos, true))); pos += 4; break; // LONG_BINGET
      case 0x63: { // GLOBAL
        const a = data.indexOf(10, pos);
        const b = data.indexOf(10, a + 1);
        const module = td.decode(data.subarray(pos, a));
        const name = td.decode(data.subarray(a + 1, b));
        pos = b + 1;
        stack.push(global(module, name));
        break;
      }
      case 0x93: { const name = stack.pop(); stack.push(global(stack.pop(), name)); break; } // STACK_GLOBAL
      case 0x74: stack.push(popMark()); break; // TUPLE
      case 0x85: stack.push([stack.pop()]); break; // TUPLE1
      case 0x86: stack.push(stack.splice(-2)); break; // TUPLE2
      case 0x87: stack.push(stack.splice(-3)); break; // TUPLE3
      case 0x61: { const v = stack.pop(); stack.at(-1).push(v); break; } // APPEND
      case 0x65: { const items = popMark(); stack.at(-1).push(...items); break; } // APPENDS
      case 0x73: { const v = stack.pop(); const k = stack.pop(); stack.at(-1).set(k, v); break; } // SETITEM
      case 0x75: { // SETITEMS
        const items = popMark();
        const d = stack.at(-1);
        for (let i = 0; i < items.length; i += 2) d.set(items[i], items[i + 1]);
        break;
      }
      case 0x52: case 0x81: { const args = stack.pop(); stack.push(call(stack.pop(), args)); break; } // REDUCE, NEWOBJ
      case 0x62: { const st = stack.pop(); const obj = stack.at(-1); if (obj instanceof PyObject) obj.state = st; break; } // BUILD
      case 0x51: stack.push(persistentLoad(stack.pop())); break; // BINPERSID
      default: throw new Error(`pickle: опкод 0x${op.toString(16)} (позиция ${pos - 1}) не поддерживается`);
    }
  }
}

const STORAGE = { FloatStorage: Float32Array, LongStorage: BigInt64Array, IntStorage: Int32Array, DoubleStorage: Float64Array, BoolStorage: Uint8Array };

/** Тензор: данные в порядке строк (row-major) и форма. */
function rebuildTensor(storage, offset, shape, stride) {
  const numel = shape.reduce((a, b) => a * b, 1);
  let contiguous = true;
  for (let d = shape.length - 1, expect = 1; d >= 0; d--) {
    if (shape[d] === 1) continue;
    if (stride[d] !== expect) contiguous = false;
    expect *= shape[d];
  }
  if (contiguous) return { data: storage.subarray(offset, offset + numel), shape };
  const out = new storage.constructor(numel);
  const idx = new Array(shape.length).fill(0);
  for (let i = 0; i < numel; i++) {
    let src = offset;
    for (let d = 0; d < shape.length; d++) src += idx[d] * stride[d];
    out[i] = storage[src];
    for (let d = shape.length - 1; d >= 0 && ++idx[d] === shape[d]; d--) idx[d] = 0;
  }
  return { data: out, shape };
}

/** Python-объект → обычный JS: Map со строковыми ключами — объект, PyObject — его состояние плюс поле type. */
export function plain(v) {
  if (v instanceof PyObject) {
    const st = plain(v.state ?? null);
    return st && typeof st === "object" && !Array.isArray(st) ? { type: v.name, ...st } : { type: v.name, state: st };
  }
  if (v instanceof Map) {
    if ([...v.keys()].every((k) => typeof k === "string")) return Object.fromEntries([...v].map(([k, x]) => [k, plain(x)]));
    return new Map([...v].map(([k, x]) => [k, plain(x)]));
  }
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

/**
 * Модуль TorchScript из архива: <prefix>/data.pkl → дерево модулей (plain), тензоры — { data, shape }.
 * storagePath(key) — путь записи с сырыми байтами хранилища.
 */
export function loadScriptModule(zip, prefix, storagePath) {
  const storages = new Map();
  const find = (module, name) => {
    if (module === "torch._utils" && name === "_rebuild_tensor_v2")
      return (storage, offset, shape, stride) => ({ tensor: rebuildTensor(storage, offset, shape, stride) });
    if (module === "torch" && STORAGE[name]) return { storage: STORAGE[name] };
    if (module === "torch.jit._pickle" && name.startsWith("build_")) return (x) => x;
    if (module === "collections" && name === "OrderedDict") return () => new Map();
    return undefined;
  };
  const persistentLoad = ([kind, type, key, , numel]) => {
    if (kind !== "storage") throw new Error(`неизвестная постоянная ссылка ${kind}`);
    if (!storages.has(key)) {
      const bytes = zip.read(storagePath(key));
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes); // выравнивание под типизированный массив
      storages.set(key, new type.storage(copy.buffer, 0, numel));
    }
    return storages.get(key);
  };
  const tree = unpickle(zip.read(`${prefix}/data.pkl`), { find, persistentLoad });
  const unwrap = (v) => {
    if (v && typeof v === "object" && "tensor" in v && Object.keys(v).length === 1) return v.tensor;
    if (Array.isArray(v)) return v.map(unwrap);
    if (v && typeof v === "object" && !(v instanceof Map) && !ArrayBuffer.isView(v))
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
    return v;
  };
  return unwrap(plain(tree));
}
