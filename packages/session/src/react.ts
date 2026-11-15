"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DependencyList } from "react";
import { session } from "./client";
import { appendUnique, type CursorPage } from "./paging";
import { browserLoopEnv, sameDeps, startResourceLoop } from "./resource";
import type { Me, SessionState } from "./types";

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState, session.getServerState);
}

type Kind = Me["kind"];

/**
 * Сколько секунд после logout() этой вкладкой гард не делает свой переход: со страницы уже уводит вызвавший выход.
 * Два router.replace на разные адреса в один такт (гард и кнопка «Выйти») в Next 16 взаимно отменяют навигацию —
 * страница остаётся со скелетом загрузки. Прочие пути к «anonymous» (токен отозван, выход в другой вкладке) это окно
 * не задевают: logoutAt меняет только локальный logout().
 */
const LOGOUT_NAV_GRACE_MS = 5_000;

/**
 * Страница только для вошедших: восстанавливает сессию, без неё — переход на `loginHref`.
 * Возвращает аккаунт нужного вида или null, пока идёт проверка.
 */
export function useRequireAccount(kind: Kind | Kind[], loginHref: string): Me | null {
  const state = useSession();
  const router = useRouter();
  // Список видов — строкой: массив из вызова новый на каждый рендер, а эффект зависит от содержимого.
  const kindKey = (Array.isArray(kind) ? kind : [kind]).join(",");
  const ok = state.status === "authenticated" && kindKey.split(",").includes(state.account.kind);
  useEffect(() => {
    void session.restore();
  }, []);
  useEffect(() => {
    if (state.status === "anonymous" || (state.status === "authenticated" && !kindKey.split(",").includes(state.account.kind))) {
      // Только что вышли кнопкой — навигацию делает вызвавший logout(); свой replace здесь был бы вторым.
      if (session.logoutAt !== null && Date.now() - session.logoutAt < LOGOUT_NAV_GRACE_MS) return;
      router.replace(loginHref);
    }
  }, [state, kindKey, loginHref, router]);
  return ok ? state.account : null;
}

/** Сколько целых секунд осталось до момента `until` (мс, часы устройства); 0 — уже наступил или не задан. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** Сеть есть? (navigator.onLine + события online/offline.) */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** Идёт загрузка: первая, после смены зависимостей или reload(). */
  loading: boolean;
  reload: () => void;
  setData: (fn: (prev: T | undefined) => T | undefined) => void;
}

export interface ResourceOptions {
  /** Период опроса, мс. Опрос встаёт на паузу в скрытой вкладке и без сети и сразу повторяется при возвращении. */
  pollMs?: number;
  enabled?: boolean;
  /**
   * При смене зависимостей оставить прежние данные на экране, пока грузятся новые (зависимость — повод обновить тот же
   * список, например счётчик заявок). По умолчанию данные сбрасываются: они относятся к прежним зависимостям.
   */
  keepPrevious?: boolean;
}

/**
 * Загрузка данных (startResourceLoop, resource.ts). Смена `deps` — новая загрузка: `loading` сразу true, прежние
 * данные и ошибка сброшены (кроме `keepPrevious`). Ошибка опроса оставляет последние данные на экране.
 */
export function useResource<T>(load: () => Promise<T>, deps: DependencyList, opts: ResourceOptions = {}): Resource<T> {
  const { pollMs, enabled = true, keepPrevious = false } = opts;
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  // Версия зависимостей: меняется в том же рендере, что и deps, — экран не видит данных прежних зависимостей.
  const [seen, setSeen] = useState<{ deps: DependencyList; enabled: boolean; version: number }>({ deps, enabled, version: 0 });
  if (!sameDeps(seen.deps, deps) || seen.enabled !== enabled) {
    const depsChanged = !sameDeps(seen.deps, deps);
    setSeen({ deps, enabled, version: seen.version + (depsChanged ? 1 : 0) });
    if (depsChanged && !keepPrevious) {
      setDataState(undefined);
      setError(undefined);
    }
    setLoading(enabled);
  }
  const version = seen.version;
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!enabled) return;
    return startResourceLoop(
      () => loadRef.current(),
      (result) => {
        if (result.ok) {
          setDataState(result.value);
          setError(undefined);
        } else {
          setError(result.error);
        }
        setLoading(false);
      },
      { pollMs, env: browserLoopEnv },
    );
  }, [version, tick, enabled, pollMs]);

  const reload = useCallback(() => {
    setLoading(true);
    setTick((t) => t + 1);
  }, []);
  const setData = useCallback((fn: (prev: T | undefined) => T | undefined) => setDataState(fn), []);
  return { data, error, loading, reload, setData };
}

export interface CursorList<T> {
  /** Показанные элементы; null — первая страница ещё не пришла. */
  items: T[] | null;
  /** У списка есть следующая страница («Показать ещё»). */
  hasMore: boolean;
  /** Идёт загрузка следующей страницы: кнопка «Показать ещё» в состоянии загрузки. */
  loadingMore: boolean;
  /**
   * Новый список — первая страница (null — «загружается»): сменился фильтр или список перезагружен. Ответ на начатое
   * до этого «Показать ещё» отбрасывается — страница старого списка не попадёт в новый.
   */
  reset: (page: CursorPage<T> | null) => void;
  /**
   * Следующая страница. Пока она грузится, повторный вызов ничего не запрашивает (двойное нажатие — один запрос);
   * элементы добавляются без дублей по `id`. Ошибка запроса — исключение: его показывает вызывающий.
   */
  loadMore: (fetchPage: (cursor: string) => Promise<CursorPage<T>>) => Promise<void>;
  /** Изменить показанные элементы (например, убрать решённую заявку). */
  update: (fn: (items: T[]) => T[]) => void;
}

/** Курсорный список с «Показать ещё»: один запрос за раз, без дублей, без страниц устаревшего списка. */
export function useCursorList<T extends { id: string }>(): CursorList<T> {
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  // Курсор и флаг «в работе» — ещё и в ref: второе нажатие может прийти раньше перерисовки с новым состоянием.
  const cursorRef = useRef<string | undefined>(undefined);
  const inflight = useRef(false);
  const generation = useRef(0);

  const reset = useCallback((page: CursorPage<T> | null) => {
    generation.current++;
    inflight.current = false;
    cursorRef.current = page?.nextCursor;
    setItems(page ? appendUnique([], page.items) : null);
    setCursor(page?.nextCursor);
    setLoadingMore(false);
  }, []);

  const loadMore = useCallback(async (fetchPage: (cursor: string) => Promise<CursorPage<T>>) => {
    const from = cursorRef.current;
    if (!from || inflight.current) return;
    inflight.current = true;
    setLoadingMore(true);
    const gen = generation.current;
    try {
      const page = await fetchPage(from);
      if (gen !== generation.current) return;
      cursorRef.current = page.nextCursor;
      setItems((list) => appendUnique(list ?? [], page.items));
      setCursor(page.nextCursor);
    } finally {
      if (gen === generation.current) {
        inflight.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  const update = useCallback((fn: (items: T[]) => T[]) => setItems((list) => (list ? fn(list) : list)), []);

  return { items, hasMore: Boolean(cursor), loadingMore, reset, loadMore, update };
}
