// Сроки сервера считаются по часам сервера — поправка по заголовку Date.
import { afterEach, describe, expect, it, vi } from "vitest";
import { knowsServerTime, msUntil, observeServerDate, resetServerClock, serverNow } from "../src/clock";

const res = (date: string | null) => ({ headers: new Headers(date ? { date } : {}) });

afterEach(() => {
  resetServerClock();
  vi.useRealTimers();
});

describe("часы сервера", () => {
  it("без ответов сервера — часы устройства", () => {
    expect(knowsServerTime()).toBe(false);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(5);
  });

  it("часы устройства спешат на 20 минут — свежий код (15 мин) не «истёк»", () => {
    const server = Date.parse("2026-11-03T09:00:00Z");
    vi.useFakeTimers({ now: server + 20 * 60_000 });
    observeServerDate(res(new Date(server).toUTCString()), Date.now() - 100, Date.now());
    expect(knowsServerTime()).toBe(true);
    expect(Math.abs(serverNow() - server)).toBeLessThan(1_000);
    const expiresAt = new Date(server + 15 * 60_000).toISOString();
    expect(msUntil(expiresAt)).toBeGreaterThan(14 * 60_000);
    // Наивный расчёт по часам устройства — «истёк» на 5 минут.
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThan(0);
  });

  it("берётся самый точный замер; перевод часов устройства (скачок > 5 с) замещает старый", () => {
    const server = Date.parse("2026-11-03T09:00:00Z");
    vi.useFakeTimers({ now: server });
    observeServerDate(res(new Date(server).toUTCString()), Date.now() - 40, Date.now());
    observeServerDate(res(new Date(server + 3_000).toUTCString()), Date.now() - 2_000, Date.now());
    expect(Math.abs(serverNow() - server)).toBeLessThan(600);
    vi.setSystemTime(server + 3_600_000);
    observeServerDate(res(new Date(server).toUTCString()), Date.now() - 2_000, Date.now());
    expect(Math.abs(serverNow() - server)).toBeLessThan(2_000);
  });

  it("ответ без Date или с битым Date ничего не меняет", () => {
    observeServerDate(res(null), Date.now(), Date.now());
    observeServerDate(res("yesterday"), Date.now(), Date.now());
    expect(knowsServerTime()).toBe(false);
  });
});
