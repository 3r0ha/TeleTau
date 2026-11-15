// Бюджет и предохранитель шлюза (docs/04-ai-gigachat.md §4): вызовы провайдера ограничены числом в сутки по Уфе,
// а после серии сбоев провайдер на время не вызывается — запросы сразу получают 503, API отдаёт шаблон.
// Состояние — в памяти процесса: шлюз один, его перезапуск обнуляет счётчики (лимит остаётся верхней границей
// на процесс).

const DAY_MS = 86_400_000;
/** Уфа — постоянно UTC+5. */
const UFA_OFFSET_MS = 5 * 3_600_000;

export const ufaDayNumber = (ms: number): number => Math.floor((ms + UFA_OFFSET_MS) / DAY_MS);

/** Дневной бюджет вызовов провайдера: `take()` расходует один вызов, false — бюджет суток исчерпан. */
export class DailyBudget {
  private day = Number.NaN;
  private used = 0;

  constructor(
    readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const day = ufaDayNumber(this.now());
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }

  /** Израсходовано за текущие сутки. */
  usedToday(): number {
    return ufaDayNumber(this.now()) === this.day ? this.used : 0;
  }
}

/**
 * Предохранитель: `threshold` сбоев провайдера подряд — вызовы закрыты на `cooldownMs`. После паузы проходит
 * пробный вызов: его сбой снова закрывает предохранитель, успех сбрасывает счётчик.
 */
export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    readonly threshold: number,
    readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(): boolean {
    return this.now() >= this.openUntil;
  }

  success(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = this.now() + this.cooldownMs;
      // Пробный вызов после паузы: один сбой — снова пауза.
      this.failures = this.threshold - 1;
    }
  }
}
