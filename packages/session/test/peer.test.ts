// Адрес сокета в служебном заголовке ставит сам HTTP-сервер вместе с секретом процесса — клиент
// не может ни подставить адрес, ни подделать отметку (секрет он не знает).
import { createServer, request, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { PEER_HEADER, PEER_SECRET_KEY, PEER_TOKEN_HEADER, peerSecret, stampedPeer } from "../src/client-ip";
import { installPeerAddressStamp } from "../src/peer";

describe("отметка адреса сокета", () => {
  installPeerAddressStamp();
  installPeerAddressStamp(); // повторный вызов безопасен и не меняет секрет
  let seen: IncomingMessage["headers"] | null = null;
  const server = createServer((req, res) => {
    seen = req.headers;
    res.end("ok");
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("значения клиента с теми же именами перезаписываются адресом сокета и секретом процесса", async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/", headers: { [PEER_HEADER]: "198.18.0.1", [PEER_TOKEN_HEADER]: "forged", "x-forwarded-for": "198.18.0.1" } },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(seen?.[PEER_HEADER]).toBe("127.0.0.1");
    expect(seen?.[PEER_TOKEN_HEADER]).toBe(peerSecret());
    expect(seen?.["x-forwarded-for"]).toBe("198.18.0.1");
    // Отметка сервера принимается BFF, а адрес — тот, что поставил сервер.
    expect(stampedPeer(new Headers(seen as Record<string, string>))).toBe("127.0.0.1");
  });

  it("секрет процесса — случайный, не короче 256 бит", () => {
    const secret = peerSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });
});

describe("stampedPeer: адрес из отметки — только при совпадении секрета процесса", () => {
  it("без секрета или с неверным секретом — null; с верным — адрес", () => {
    const secret = peerSecret()!;
    const h = (token?: string) => new Headers({ [PEER_HEADER]: "203.0.113.7", ...(token === undefined ? {} : { [PEER_TOKEN_HEADER]: token }) });
    expect(stampedPeer(h())).toBeNull();
    expect(stampedPeer(h(""))).toBeNull();
    expect(stampedPeer(h("forged"))).toBeNull();
    expect(stampedPeer(h(secret.toUpperCase() === secret ? secret.toLowerCase() : secret.toUpperCase()))).toBeNull();
    expect(stampedPeer(h(`${secret}x`))).toBeNull();
    expect(stampedPeer(h(secret.slice(1)))).toBeNull();
    expect(stampedPeer(h(secret))).toBe("203.0.113.7");
  });

  it("секрета процесса ещё нет (отметка не установлена — окно запуска Next.js) — не принимается ничего", () => {
    const g = globalThis as Record<symbol, unknown>;
    const saved = g[PEER_SECRET_KEY];
    try {
      delete g[PEER_SECRET_KEY];
      for (const token of ["", "undefined", "null", String(saved)]) {
        expect(stampedPeer(new Headers({ [PEER_HEADER]: "203.0.113.7", [PEER_TOKEN_HEADER]: token })), token).toBeNull();
      }
    } finally {
      g[PEER_SECRET_KEY] = saved;
    }
  });
});
