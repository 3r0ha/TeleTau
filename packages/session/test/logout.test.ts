// Выход без сети: logout() не бросает, вкладка всё равно забывает сессию (кнопка «Выйти» не зависает в загрузке).
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "../src/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session.logout", () => {
  it("сеть недоступна: не бросает, возвращает false, состояние — «не вошёл»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(session.logout()).resolves.toBe(false);
    expect(session.getState()).toEqual({ status: "anonymous" });
    expect(session.logoutAt).not.toBeNull();
  });

  it("сервер ответил ошибкой: не бросает, состояние — «не вошёл»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: 503, code: "api_unavailable" }), { status: 503 })));
    await expect(session.logout()).resolves.toBe(false);
    expect(session.getState().status).toBe("anonymous");
  });

  it("сервер подтвердил выход: true", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(session.logout()).resolves.toBe(true);
    expect(session.getState().status).toBe("anonymous");
  });
});
