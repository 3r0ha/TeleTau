import type { Page } from "@playwright/test";

/**
 * Дожидается конечных анимаций (появление листа, карточки, тоста) перед проверкой axe: контраст считается на
 * итоговом кадре, а не на полупрозрачном. Бесконечные (скелетоны, спиннеры) не ждём — цвет текста они не меняют.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const end = a.effect?.getComputedTiming().endTime;
      return a.playState === "running" && typeof end === "number" && Number.isFinite(end);
    });
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}
