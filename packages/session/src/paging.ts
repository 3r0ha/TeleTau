// Курсорные списки «Показать ещё» (docs/07 §2 «Пагинация»). Чистые функции — без React: их проверяют юнит-тесты,
// а хук useCursorList (react.ts) держит на них состояние экрана.

/** Страница курсорного списка по контракту: элементы и курсор следующей страницы (нет — страниц больше нет). */
export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * Добавить страницу к списку без дублей по `id`: уже показанный элемент не повторяется, даже если сервер вернул его
 * снова (страница запрошена дважды или очередь сдвинулась между запросами). Порядок — как пришёл с сервера.
 */
export function appendUnique<T extends { id: string }>(list: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(list.map((item) => item.id));
  const out = [...list];
  for (const item of page) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
