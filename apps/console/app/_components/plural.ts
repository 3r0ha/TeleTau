/** Форма слова после числа: 1 класс, 2 класса, 5 классов (21 — «один», 11–14 — «много»). */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}
