// IP браузера для BFF. Лимиты частоты API считаются по IP ученика, поэтому BFF передаёт его в
// X-Forwarded-For. Заголовок X-Forwarded-For, присланный клиентом, BFF НЕ пересылает: иначе любой мог бы назвать себя
// новым адресом на каждый запрос и обойти лимит. Источник IP:
// - адрес сокета запроса (его ставит peer.ts в заголовок PEER_HEADER, перезаписывая любое значение клиента);
// - если сокет — доверенный балансировщик (BFF_TRUST_PROXY), то адрес, который добавил он: X-Forwarded-For читается
//   справа налево, доверенные адреса пропускаются, первый недоверенный — клиент.
// Отметке адреса BFF верит, только если рядом стоит секрет процесса: запросы, пришедшие в окне запуска Next.js
// до установки отметки, несут служебные заголовки клиента как есть, но секрета клиент не знает.

/** Служебный заголовок с адресом сокета (ставит сервер Next.js, см. peer.ts). */
export const PEER_HEADER = "x-teletau-peer-address";

/** Второй служебный заголовок отметки: секрет процесса, известный только серверу Next.js этого процесса. */
export const PEER_TOKEN_HEADER = "x-teletau-peer-token";

/**
 * Где лежит секрет процесса. globalThis, а не переменная модуля: instrumentation.ts (ставит отметку) и обработчики
 * маршрутов (читают её) Next.js собирает в разные бандлы, но процесс у них один.
 */
export const PEER_SECRET_KEY = Symbol.for("teletau.peer-address-secret");

/** Секрет процесса для отметки адреса; нет — отметка ещё не установлена (peer.ts → installPeerAddressStamp). */
export function peerSecret(): string | undefined {
  const value = (globalThis as Record<symbol, unknown>)[PEER_SECRET_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Сравнение с секретом за время, не зависящее от того, где строки расходятся (только от длины секрета). */
function matchesSecret(candidate: string, secret: string): boolean {
  let diff = candidate.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) diff |= (candidate.charCodeAt(i) | 0) ^ secret.charCodeAt(i);
  return diff === 0;
}

/**
 * Адрес сокета из отметки сервера — только если секрет в PEER_TOKEN_HEADER совпал с секретом процесса. Иначе null:
 * запрос не прошёл через отметку (окно запуска Next.js, отметка не установлена), а служебные заголовки — от клиента.
 */
export function stampedPeer(headers: { get(name: string): string | null }): string | null {
  const secret = peerSecret();
  const token = headers.get(PEER_TOKEN_HEADER);
  if (!secret || !token || !matchesSecret(token, secret)) return null;
  return headers.get(PEER_HEADER);
}

type Range = { v: 4 | 6; base: bigint; bits: number };

const RANGES: Record<string, string[]> = {
  loopback: ["127.0.0.0/8", "::1/128"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  uniquelocal: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
};

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8n) | BigInt(Number(p));
  }
  return n;
}

function parseV6(input: string): bigint | null {
  let s = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  // Хвост в форме IPv4 (::ffff:1.2.3.4) → две группы по 16 бит.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const n = parseV4(v4[1]!);
    if (n === null) return null;
    s = `${s.slice(0, v4.index)}${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** Адрес → число и версия; IPv4 внутри IPv6 (::ffff:a.b.c.d) считается IPv4. null — не IP. */
export function parseIp(input: string): { v: 4 | 6; n: bigint } | null {
  const s = input.trim();
  const v4 = parseV4(s);
  if (v4 !== null) return { v: 4, n: v4 };
  const v6 = parseV6(s);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) return { v: 4, n: v6 & 0xffffffffn };
  return { v: 6, n: v6 };
}

function parseRange(entry: string): Range | null {
  const [addr, len] = entry.split("/");
  const ip = parseIp(addr ?? "");
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const bits = len === undefined ? max : Number(len);
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(max - bits);
  return { v: ip.v, base: ip.n & mask, bits };
}

export interface TrustList {
  /** Адрес принадлежит доверенному балансировщику. */
  has(address: string): boolean;
  readonly empty: boolean;
}

/**
 * BFF_TRUST_PROXY: адреса и подсети балансировщика перед Next.js через запятую, а также имена диапазонов
 * `loopback`, `linklocal`, `uniquelocal` (как TRUST_PROXY у API). Пусто — X-Forwarded-For не читается вовсе.
 * Нераспознанный элемент — ошибка конфигурации (лучше упасть при старте, чем молча доверять не тем).
 */
export function parseTrustList(raw: string | undefined): TrustList {
  const ranges: Range[] = [];
  for (const item of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const named = RANGES[item.toLowerCase()];
    for (const entry of named ?? [item]) {
      const r = parseRange(entry);
      if (!r) throw new Error(`BFF_TRUST_PROXY: «${item}» — не IP, не подсеть и не loopback/linklocal/uniquelocal`);
      ranges.push(r);
    }
  }
  return {
    empty: ranges.length === 0,
    has(address: string) {
      const ip = parseIp(address);
      if (!ip) return false;
      return ranges.some((r) => {
        if (r.v !== ip.v) return false;
        const max = r.v === 4 ? 32 : 128;
        const mask = r.bits === 0 ? 0n : ((1n << BigInt(r.bits)) - 1n) << BigInt(max - r.bits);
        return (ip.n & mask) === r.base;
      });
    },
  };
}

/** Каноническая запись адреса для X-Forwarded-For: IPv4 внутри IPv6 — как IPv4. */
function canonical(address: string): string {
  const ip = parseIp(address);
  if (!ip) return address.trim();
  if (ip.v === 4) return [24n, 16n, 8n, 0n].map((s) => String((ip.n >> s) & 0xffn)).join(".");
  return address.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * IP клиента. peer — адрес сокета (stampedPeer: из PEER_HEADER с верным секретом), forwardedFor — X-Forwarded-For запроса.
 * Нет адреса сокета — undefined: BFF не передаёт IP вовсе (лимит API считается по адресу самого BFF — строже, но не обходится).
 */
export function clientIp({ peer, forwardedFor, trust }: { peer: string | null | undefined; forwardedFor: string | null | undefined; trust: TrustList }): string | undefined {
  if (!peer || !parseIp(peer)) return undefined;
  if (trust.empty || !trust.has(peer)) return canonical(peer);
  const chain = (forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => parseIp(s));
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!trust.has(chain[i]!)) return canonical(chain[i]!);
  }
  // Вся цепочка — доверенные адреса (запрос пришёл с самого балансировщика): самый левый из них.
  return canonical(chain[0] ?? peer);
}
