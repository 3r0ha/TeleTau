// Открытый лист — своя запись истории; «Назад» закрывает лист, закрытие листа убирает запись, смена листа на лист
// не теряет запись нового. История браузера — модель: back() асинхронный, popstate приходит позже (как в браузере).
import { beforeEach, describe, expect, it } from "vitest";
import { openSheetEntry } from "../src/sheetHistory";

class FakeHistory {
  entries: { state: unknown; url: string }[] = [];
  index = 0;
  listeners: ((e: PopStateEvent) => void)[] = [];
  reset(url: string) {
    this.entries = [{ state: { __NA: true, tree: url }, url }];
    this.index = 0;
  }
  get state() {
    return this.entries[this.index]!.state;
  }
  get url() {
    return this.entries[this.index]!.url;
  }
  pushState(state: unknown, _unused: string, url?: string) {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ state, url: url ?? this.url });
    this.index++;
  }
  replaceState(state: unknown, _unused: string, url?: string) {
    this.entries[this.index] = { state, url: url ?? this.url };
  }
  go(delta: number) {
    setTimeout(() => {
      const next = this.index + delta;
      if (next < 0 || next >= this.entries.length) return;
      this.index = next;
      for (const l of this.listeners) l({ state: this.state } as PopStateEvent);
    }, 0);
  }
  back() {
    this.go(-1);
  }
}

const history = new FakeHistory();
(globalThis as { window?: unknown }).window = {
  history,
  addEventListener: (type: string, fn: (e: PopStateEvent) => void) => {
    if (type === "popstate") history.listeners.push(fn);
  },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  history.reset("/teacher/classes/c5");
});

describe("лист и история браузера", () => {
  it("открытый лист — запись на том же адресе с состоянием Next.js; «Назад» закрывает лист, адрес прежний", async () => {
    const closed: string[] = [];
    openSheetEntry(() => closed.push("seat"));
    expect(history.entries).toHaveLength(2);
    expect(history.url).toBe("/teacher/classes/c5");
    expect(history.state).toMatchObject({ __NA: true, tree: "/teacher/classes/c5" });
    history.back();
    await settle();
    expect(closed).toEqual(["seat"]);
    expect(history.index).toBe(0);
  });

  it("закрытие крестиком убирает запись листа: popstate своего back() лист не трогает", async () => {
    const closed: string[] = [];
    const release = openSheetEntry(() => closed.push("seat"));
    release();
    release(); // повторный вызов безопасен
    await settle();
    expect(closed).toEqual([]);
    expect(history.index).toBe(0);
  });

  it("лист сменяет лист (доска → заявки): новая запись ставится после возврата, «Назад» закрывает только новый", async () => {
    const closed: string[] = [];
    const releaseBoard = openSheetEntry(() => closed.push("board"));
    // Один коммит React: сначала очистка эффекта доски, затем эффект заявок.
    releaseBoard();
    openSheetEntry(() => closed.push("requests"));
    await settle();
    expect(history.entries).toHaveLength(2);
    expect(history.index).toBe(1);
    history.back();
    await settle();
    expect(closed).toEqual(["requests"]);
    expect(history.index).toBe(0);
  });

  it("лист закрыт до того, как его запись успела появиться, — записи нет", async () => {
    const releaseA = openSheetEntry(() => undefined);
    releaseA();
    const releaseB = openSheetEntry(() => undefined);
    releaseB();
    await settle();
    expect(history.entries.slice(0, history.index + 1)).toHaveLength(1);
  });

  it("переход Next.js при открытом листе заменил запись — при закрытии листа back() не вызывается", async () => {
    const release = openSheetEntry(() => undefined);
    history.replaceState({ __NA: true, tree: "/teacher/classes/c7" }, "", "/teacher/classes/c7");
    release();
    await settle();
    expect(history.url).toBe("/teacher/classes/c7");
    expect(history.index).toBe(1);
  });

  it("«Вперёд» на запись уже закрытого листа не открывает его и ничего не закрывает", async () => {
    const closed: string[] = [];
    openSheetEntry(() => closed.push("seat"));
    history.back();
    await settle();
    history.go(1);
    await settle();
    expect(closed).toEqual(["seat"]);
  });
});
