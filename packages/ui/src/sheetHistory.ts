// «Назад» закрывает открытый лист, а не уводит со страницы (Material 3 predictive back, жест iOS, браузер).
// Открытый лист — своя запись истории на том же адресе: pushState с меткой листа в history.state. «Назад» — popstate —
// закрывает листы, открытые после записи, на которую вернулись. Закрытие крестиком, Esc или кнопкой убирает свою запись
// (history.back()), чтобы следующий «Назад» не был «пустым».
//
// Совместимость с Next.js (app router):
// - в запись копируется history.state Next.js (__NA и дерево): popstate на ней Next обрабатывает как обычный переход по
//   истории на тот же адрес, без перезагрузки; шаги в адресе (?step=) не трогаются — адрес записи тот же;
// - history.back() асинхронный, поэтому новая запись (лист сменяет лист: доска → заявки) ставится только после того,
//   как дошёл popstate нашего back(), — иначе back() увёл бы со свежей записи;
// - переход Next.js при открытом листе (router.replace/push) заменяет или перекрывает запись листа — тогда при закрытии
//   листа back() не вызывается (метка текущей записи уже не наша). Закрывать лист перед router.push не нужно и нельзя:
//   back() отменил бы начатый переход — переходите router.replace при открытом листе.

const MARK = "ttSheet";
/** popstate нашего back() так и не пришёл (вкладка выгружается и т. п.) — не держать очередь бесконечно. */
const BACK_TIMEOUT_MS = 2000;

interface Entry {
  id: string;
  close: () => void;
  pushed: boolean;
  /** Лист закрыт (снят с экрана) — запись больше не нужна. */
  released: boolean;
  /** Запись ушла «Назад» браузера — лист закрыт им. */
  popped: boolean;
}

const stack: Entry[] = [];
let queue: (() => void)[] = [];
let pendingBacks = 0;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let listening = false;
let seq = 0;

const markOf = (state: unknown): unknown => (state && typeof state === "object" ? (state as Record<string, unknown>)[MARK] : undefined);

function flush(): void {
  clearTimeout(watchdog);
  watchdog = undefined;
  const run = queue;
  queue = [];
  for (const fn of run) fn();
}

function onPopState(e: PopStateEvent): void {
  if (pendingBacks > 0) {
    // Это наш back() после закрытия листа — лист уже закрыт.
    pendingBacks--;
    if (pendingBacks === 0) flush();
    return;
  }
  // «Назад» (или «Вперёд») пользователя: закрыть листы выше записи, на которой оказались.
  const mark = markOf(e.state);
  const keep = stack.findIndex((entry) => entry.id === mark);
  const closing = stack.splice(keep + 1);
  for (const entry of closing.reverse()) {
    entry.popped = true;
    entry.close();
  }
}

function whenSettled(fn: () => void): void {
  if (pendingBacks > 0) queue.push(fn);
  else fn();
}

function release(entry: Entry): void {
  if (entry.released) return;
  entry.released = true;
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (!entry.pushed || entry.popped) return;
  if (markOf(window.history.state) !== entry.id) return;
  pendingBacks++;
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    pendingBacks = 0;
    flush();
  }, BACK_TIMEOUT_MS);
  window.history.back();
}

/**
 * Лист открыт: своя запись истории. close — закрыть лист, когда пользователь нажал «Назад».
 * Возвращает функцию «лист закрыт» (крестик, Esc, кнопка, размонтирование) — она убирает запись.
 */
export function openSheetEntry(close: () => void): () => void {
  if (!listening) {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
  const entry: Entry = { id: `sheet-${Date.now().toString(36)}-${++seq}`, close, pushed: false, released: false, popped: false };
  whenSettled(() => {
    if (entry.released) return;
    const state = window.history.state && typeof window.history.state === "object" ? (window.history.state as Record<string, unknown>) : {};
    window.history.pushState({ ...state, [MARK]: entry.id }, "");
    entry.pushed = true;
    stack.push(entry);
  });
  return () => release(entry);
}
