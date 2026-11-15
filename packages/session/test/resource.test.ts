// Цикл загрузки useResource без браузера: скрытая вкладка, опрос, пробуждение, остановка при смене зависимостей.
import { describe, expect, it } from "vitest";
import { sameDeps, startResourceLoop, type LoopEnv, type LoopResult } from "../src/resource";

function fakeEnv(opts: { hidden?: boolean; online?: boolean } = {}) {
  const state = { hidden: opts.hidden ?? false, online: opts.online ?? true };
  const wakers = new Set<() => void>();
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const env: LoopEnv = {
    hidden: () => state.hidden,
    online: () => state.online,
    subscribeWake(cb) {
      wakers.add(cb);
      return () => wakers.delete(cb);
    },
    setTimer(cb) {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    env,
    state,
    wake: () => [...wakers].forEach((cb) => cb()),
    wakers,
    timers,
    fireTimers: () => {
      const due = [...timers.values()];
      timers.clear();
      due.forEach((cb) => cb());
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function counter<T>(values: T[]) {
  let calls = 0;
  return {
    load: async () => {
      const v = values[Math.min(calls, values.length - 1)]!;
      calls++;
      return v;
    },
    calls: () => calls,
  };
}

describe("startResourceLoop", () => {
  it("видимая вкладка: разовый ресурс загружается сразу и один раз", async () => {
    const f = fakeEnv();
    const c = counter(["a"]);
    const results: LoopResult<string>[] = [];
    startResourceLoop(c.load, (r) => results.push(r), { env: f.env });
    await flush();
    expect(results).toEqual([{ ok: true, value: "a" }]);
    f.wake();
    await flush();
    expect(c.calls()).toBe(1);
    expect(f.wakers.size).toBe(0);
  });

  it("вкладка скрыта при открытии: разовый ресурс ждёт показа вкладки, а не висит в загрузке", async () => {
    const f = fakeEnv({ hidden: true });
    const c = counter(["a"]);
    const results: LoopResult<string>[] = [];
    startResourceLoop(c.load, (r) => results.push(r), { env: f.env });
    await flush();
    expect(c.calls()).toBe(0);
    f.state.hidden = false;
    f.wake();
    await flush();
    expect(results).toEqual([{ ok: true, value: "a" }]);
  });

  it("опрос: следующий запрос по таймеру, в скрытой вкладке пауза, при показе — сразу", async () => {
    const f = fakeEnv();
    const c = counter([1, 2, 3]);
    const values: number[] = [];
    startResourceLoop(c.load, (r) => r.ok && values.push(r.value), { env: f.env, pollMs: 1000 });
    await flush();
    expect(values).toEqual([1]);
    expect(f.timers.size).toBe(1);
    f.state.hidden = true;
    f.fireTimers();
    await flush();
    expect(c.calls()).toBe(1);
    expect(f.timers.size).toBe(0);
    f.state.hidden = false;
    f.wake();
    await flush();
    expect(values).toEqual([1, 2]);
    expect(f.timers.size).toBe(1);
  });

  it("ошибка сообщается, опрос продолжается", async () => {
    const f = fakeEnv();
    let n = 0;
    const results: LoopResult<number>[] = [];
    startResourceLoop(
      async () => {
        n++;
        if (n === 1) throw new TypeError("offline");
        return n;
      },
      (r) => results.push(r),
      { env: f.env, pollMs: 1000 },
    );
    await flush();
    expect(results[0]?.ok).toBe(false);
    f.fireTimers();
    await flush();
    expect(results[1]).toEqual({ ok: true, value: 2 });
  });

  it("пробуждение без сети не запускает запрос", async () => {
    const f = fakeEnv();
    const c = counter([1]);
    startResourceLoop(c.load, () => undefined, { env: f.env, pollMs: 1000 });
    await flush();
    f.state.online = false;
    f.wake();
    await flush();
    expect(c.calls()).toBe(1);
  });

  it("пробуждение во время запроса не запускает второй", async () => {
    const f = fakeEnv();
    let calls = 0;
    let release: (v: number) => void = () => undefined;
    startResourceLoop(
      () => {
        calls++;
        return new Promise<number>((r) => (release = r));
      },
      () => undefined,
      { env: f.env, pollMs: 1000 },
    );
    f.wake();
    f.wake();
    expect(calls).toBe(1);
    release(1);
    await flush();
    expect(f.timers.size).toBe(1);
  });

  it("после остановки ответ прежнего запроса не сообщается и опрос не продолжается", async () => {
    const f = fakeEnv();
    let release: (v: string) => void = () => undefined;
    const results: LoopResult<string>[] = [];
    const stop = startResourceLoop(() => new Promise<string>((r) => (release = r)), (r) => results.push(r), { env: f.env, pollMs: 1000 });
    stop();
    release("old");
    await flush();
    expect(results).toEqual([]);
    expect(f.timers.size).toBe(0);
    expect(f.wakers.size).toBe(0);
  });
});

describe("sameDeps", () => {
  it("поэлементно, как у хуков React", () => {
    expect(sameDeps([1, "a", undefined], [1, "a", undefined])).toBe(true);
    expect(sameDeps([NaN], [NaN])).toBe(true);
    expect(sameDeps([1], [2])).toBe(false);
    expect(sameDeps([1], [1, 2])).toBe(false);
    expect(sameDeps([{}], [{}])).toBe(false);
  });
});
