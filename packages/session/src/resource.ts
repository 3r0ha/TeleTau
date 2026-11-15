/**
 * Цикл загрузки ресурса без React: первая загрузка, опрос, пауза в скрытой вкладке и без сети. useResource (react.ts)
 * запускает цикл на каждый набор зависимостей и останавливает при смене; окружение (видимость, сеть, таймеры)
 * подставляется, поэтому цикл проверяется юнит-тестами без браузера.
 */

export interface LoopEnv {
  /** Вкладка скрыта (document.hidden). */
  hidden(): boolean;
  /** Сеть есть (navigator.onLine). */
  online(): boolean;
  /** Подписка на «пробуждение»: вкладка снова видна или вернулась сеть. Возвращает отписку. */
  subscribeWake(cb: () => void): () => void;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export type LoopResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface LoopOptions {
  /** Период опроса, мс; без него ресурс загружается один раз. */
  pollMs?: number;
  env: LoopEnv;
}

/**
 * Запустить цикл. Скрытая вкладка не загружает: первая загрузка ждёт, пока вкладку покажут, опрос встаёт на паузу
 * и сразу повторяется при возвращении. Разовый ресурс после первого ответа на пробуждение не перечитывается: в webview
 * Telegram visibilitychange приходит регулярно, и данные не должны молча меняться под пользователем. Одновременно
 * идёт не больше одного запроса. Возвращает остановку: после неё результаты не сообщаются.
 */
export function startResourceLoop<T>(load: () => Promise<T>, onResult: (r: LoopResult<T>) => void, { pollMs, env }: LoopOptions): () => void {
  let stopped = false;
  let inflight = false;
  let answered = false;
  let timer: unknown;
  let unsubscribe: (() => void) | undefined;

  const run = async () => {
    if (stopped || inflight || env.hidden()) return;
    inflight = true;
    let result: LoopResult<T>;
    try {
      result = { ok: true, value: await load() };
    } catch (error) {
      result = { ok: false, error };
    }
    inflight = false;
    if (stopped) return;
    answered = true;
    onResult(result);
    if (pollMs) {
      timer = env.setTimer(() => void run(), pollMs);
    } else {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  };

  const onWake = () => {
    if (stopped || env.hidden() || !env.online()) return;
    if (!pollMs && answered) return;
    env.clearTimer(timer);
    void run();
  };

  unsubscribe = env.subscribeWake(onWake);
  void run();
  return () => {
    stopped = true;
    env.clearTimer(timer);
    unsubscribe?.();
    unsubscribe = undefined;
  };
}

/** Окружение браузера: document.hidden, navigator.onLine, visibilitychange и online. */
export const browserLoopEnv: LoopEnv = {
  hidden: () => typeof document !== "undefined" && document.hidden,
  online: () => typeof navigator === "undefined" || navigator.onLine,
  subscribeWake(cb) {
    if (typeof document === "undefined") return () => undefined;
    document.addEventListener("visibilitychange", cb);
    window.addEventListener("online", cb);
    return () => {
      document.removeEventListener("visibilitychange", cb);
      window.removeEventListener("online", cb);
    };
  },
  setTimer: (cb, ms) => setTimeout(cb, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout> | undefined),
};

/** Зависимости совпадают поэлементно (Object.is), как у хуков React. */
export function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}
