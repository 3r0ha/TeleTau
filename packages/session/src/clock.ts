// Часы сервера. Сроки, которые присылает сервер (код класса, задание печати PDF, access-токен), считаются
// по времени сервера, а не по часам устройства: на школьных компьютерах часы часто сбиты на минуты и часы.
// Поправка берётся из заголовка `Date` ответов: BFF /api/session/* (тот же origin — заголовок виден всегда)
// и API, если CORS его открывает. Пока ни одного ответа не было, поправка нулевая (часы устройства).

interface Observation {
  /** Время сервера минус время устройства, мс. */
  offsetMs: number;
  /** Длительность запроса, по которому оно измерено, мс (чем меньше, тем точнее). */
  roundTripMs: number;
}

/** Расхождение с прошлым замером больше этого — часы устройства перевели: старый замер больше не годится. */
const CLOCK_JUMP_MS = 5_000;

let best: Observation | null = null;

/**
 * Учесть заголовок `Date` ответа. sentAt/receivedAt — время устройства до запроса и после ответа.
 * `Date` округлён вниз до секунды, поэтому в среднем сервер на 0,5 с впереди значения заголовка.
 */
export function observeServerDate(response: Pick<Response, "headers">, sentAt: number, receivedAt: number = Date.now()): void {
  const header = response.headers.get("date");
  if (!header) return;
  const server = Date.parse(header);
  if (Number.isNaN(server)) return;
  const roundTripMs = Math.max(0, receivedAt - sentAt);
  const offsetMs = server + 500 - (sentAt + receivedAt) / 2;
  if (!best || Math.abs(offsetMs - best.offsetMs) > CLOCK_JUMP_MS || roundTripMs <= best.roundTripMs) {
    best = { offsetMs, roundTripMs };
  }
}

/** Текущее время по часам сервера (мс с эпохи). */
export function serverNow(): number {
  return Date.now() + (best?.offsetMs ?? 0);
}

/** Известна ли поправка (был хотя бы один ответ с `Date`). */
export function knowsServerTime(): boolean {
  return best !== null;
}

/** Сколько миллисекунд осталось до момента `iso` по часам сервера (отрицательное — уже прошёл). */
export function msUntil(iso: string): number {
  return Date.parse(iso) - serverNow();
}

/** Для тестов: забыть поправку. */
export function resetServerClock(): void {
  best = null;
}
