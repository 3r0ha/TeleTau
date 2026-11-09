// BFF не пересылает X-Forwarded-For клиента — IP берётся из адреса сокета или от доверенного балансировщика.
import { describe, expect, it } from "vitest";
import { clientIp, parseIp, parseTrustList } from "../src/client-ip";

const none = parseTrustList(undefined);
const lb = parseTrustList("loopback, 10.0.0.0/8");

describe("parseIp", () => {
  it("IPv4, IPv6, IPv4 внутри IPv6 и мусор", () => {
    expect(parseIp("198.18.3.4")).toEqual({ v: 4, n: 0xc6120304n });
    expect(parseIp("::ffff:127.0.0.1")).toEqual({ v: 4, n: 0x7f000001n });
    expect(parseIp("::1")?.v).toBe(6);
    expect(parseIp("fe80::1%en0")?.v).toBe(6);
    expect(parseIp("2001:db8::8a2e:370:7334")?.n).toBe(0x20010db80000000000008a2e03707334n);
    for (const bad of ["", "1.2.3", "1.2.3.256", "abc", "1::2::3", "unknown", "127.0.0.1, 1.2.3.4"]) expect(parseIp(bad), bad).toBeNull();
  });
});

describe("parseTrustList", () => {
  it("имена диапазонов, адреса и подсети; нераспознанное — ошибка конфигурации", () => {
    expect(none.empty).toBe(true);
    expect(lb.has("127.0.0.1")).toBe(true);
    expect(lb.has("::1")).toBe(true);
    expect(lb.has("::ffff:127.0.0.1")).toBe(true);
    expect(lb.has("10.20.30.40")).toBe(true);
    expect(lb.has("11.0.0.1")).toBe(false);
    expect(parseTrustList("uniquelocal").has("192.168.1.5")).toBe(true);
    expect(parseTrustList("2001:db8::/32").has("2001:db8:1::5")).toBe(true);
    expect(() => parseTrustList("loopbak")).toThrow(/BFF_TRUST_PROXY/);
    expect(() => parseTrustList("10.0.0.0/33")).toThrow(/BFF_TRUST_PROXY/);
  });
});

describe("clientIp", () => {
  it("без доверенного балансировщика присланный клиентом X-Forwarded-For игнорируется — IP сокета", () => {
    expect(clientIp({ peer: "203.0.113.7", forwardedFor: "198.18.0.1", trust: none })).toBe("203.0.113.7");
    expect(clientIp({ peer: "::ffff:203.0.113.7", forwardedFor: "1.1.1.1, 2.2.2.2", trust: none })).toBe("203.0.113.7");
    // Даже loopback-сокет без настройки BFF_TRUST_PROXY не даёт права назвать себя другим адресом.
    expect(clientIp({ peer: "127.0.0.1", forwardedFor: "198.18.0.1", trust: none })).toBe("127.0.0.1");
  });

  it("сокет не из доверенных — его адрес, что бы ни было в заголовке", () => {
    expect(clientIp({ peer: "203.0.113.7", forwardedFor: "198.18.0.1", trust: lb })).toBe("203.0.113.7");
  });

  it("за доверенным балансировщиком — адрес, который добавил он (самый правый недоверенный)", () => {
    expect(clientIp({ peer: "10.0.0.5", forwardedFor: "198.18.0.1", trust: lb })).toBe("198.18.0.1");
    // Клиент подставил левый адрес — его балансировщик оставил, а свой (настоящий адрес клиента) дописал справа.
    expect(clientIp({ peer: "10.0.0.5", forwardedFor: "6.6.6.6, 198.18.0.1", trust: lb })).toBe("198.18.0.1");
    // Цепочка из двух доверенных хопов.
    expect(clientIp({ peer: "10.0.0.5", forwardedFor: "6.6.6.6, 198.18.0.1, 10.0.0.9", trust: lb })).toBe("198.18.0.1");
    // Мусор в заголовке пропускается.
    expect(clientIp({ peer: "127.0.0.1", forwardedFor: "198.18.0.1, garbage", trust: lb })).toBe("198.18.0.1");
  });

  it("запрос с самого балансировщика (нет заголовка) — адрес сокета; нет адреса сокета — IP не передаётся", () => {
    expect(clientIp({ peer: "127.0.0.1", forwardedFor: null, trust: lb })).toBe("127.0.0.1");
    expect(clientIp({ peer: null, forwardedFor: "198.18.0.1", trust: lb })).toBeUndefined();
    expect(clientIp({ peer: "not-an-ip", forwardedFor: "198.18.0.1", trust: lb })).toBeUndefined();
  });
});
