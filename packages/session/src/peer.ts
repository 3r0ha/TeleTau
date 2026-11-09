// Адрес сокета запроса для BFF. Обработчику маршрута Next.js адрес сокета недоступен, а X-Forwarded-For Next
// заполняет им, только если клиент не прислал свой заголовок (`??=`) — по нему нельзя отличить настоящий адрес от
// подставленного. Поэтому HTTP-сервер процесса Next.js (instrumentation.ts → register) сам кладёт адрес сокета в
// служебный заголовок PEER_HEADER каждого запроса, предварительно удалив присланное клиентом значение.
// register() Next.js вызывает уже после начала приёма соединений, и запросы этого окна проходят без отметки —
// со служебными заголовками клиента. Поэтому рядом с адресом ставится секрет процесса (PEER_TOKEN_HEADER): случайный,
// создаётся при установке и не покидает процесс. BFF верит адресу только при совпадении секрета (client-ip.ts).
// Только для Node.js-рантайма: импортируется из instrumentation.ts при NEXT_RUNTIME === "nodejs".
import { randomBytes } from "node:crypto";
import { Server, type IncomingMessage } from "node:http";
import { PEER_HEADER, PEER_SECRET_KEY, PEER_TOKEN_HEADER, peerSecret } from "./client-ip";

const INSTALLED = Symbol.for("teletau.peer-address-stamp");

/** Секрет процесса: создаётся один раз (256 бит) и хранится в globalThis — его читает BFF из другого бандла. */
function ensureSecret(): string {
  const existing = peerSecret();
  if (existing) return existing;
  const secret = randomBytes(32).toString("base64url");
  (globalThis as Record<symbol, unknown>)[PEER_SECRET_KEY] = secret;
  return secret;
}

/** Положить адрес сокета в PEER_HEADER и секрет процесса в PEER_TOKEN_HEADER (значения клиента удаляются). */
export function stampPeerAddress(req: IncomingMessage): void {
  delete req.headers[PEER_HEADER];
  delete req.headers[PEER_TOKEN_HEADER];
  const address = req.socket?.remoteAddress;
  if (address) {
    req.headers[PEER_HEADER] = address;
    req.headers[PEER_TOKEN_HEADER] = ensureSecret();
  }
}

/** Подключить отметку ко всем HTTP-серверам процесса (повторный вызов ничего не меняет). */
export function installPeerAddressStamp(): void {
  ensureSecret();
  const proto = Server.prototype as Server & { [INSTALLED]?: true };
  if (proto[INSTALLED]) return;
  const emit = proto.emit as (this: Server, event: string | symbol, ...args: unknown[]) => boolean;
  proto.emit = function (this: Server, event: string | symbol, ...args: unknown[]): boolean {
    if (event === "request" || event === "checkContinue" || event === "checkExpectation") stampPeerAddress(args[0] as IncomingMessage);
    return emit.call(this, event, ...args);
  } as Server["emit"];
  proto[INSTALLED] = true;
}
