// Кеш ответов в памяти процесса со сроком жизни и общим расчётом: параллельные промахи по одному ключу ждут один
// и тот же промис, а не считают ответ каждый сам. Ошибка расчёта не кешируется. Для публичных операций без входа
// (витрина: фраза дня, словарь, доска почёта), где ответ одинаков для всех и устаревание на минуту допустимо.

export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; ttlMs: number; value: Promise<T> }>();

  constructor(
    private readonly maxEntries = 64,
    private readonly clock: () => number = Date.now,
  ) {}

  get(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const now = this.clock();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < hit.ttlMs) return hit.value;
    const value = compute();
    this.entries.set(key, { at: now, ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    if (this.entries.size > this.maxEntries) {
      for (const [k, e] of this.entries) if (now - e.at >= e.ttlMs || this.entries.size > this.maxEntries) this.entries.delete(k);
    }
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
