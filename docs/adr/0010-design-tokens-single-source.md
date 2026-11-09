# ADR 0010. Дизайн-токены — единый источник для трёх платформ

- Статус: принято (M0)

## Решение
`packages/design-tokens/tokens` (W3C DTCG) → Style Dictionary 5 → CSS-переменные (`--tt-*`), Swift (`TeleTauColor` с динамической светлой и тёмной темой), Kotlin (`TeleTauColors`, `TeleTauLightColors`, `TeleTauDarkColors`). Тест контраста WCAG 2.2 AA для пар текст/фон в обеих темах. Скрипт `scripts/check-hardcoded-colors.mjs` запрещает цвета вне токенов в коде приложений.

## Последствия
По итогам проверки контраста скорректированы `honey.700` (#B86E00 → #9A5B00: было 3,78:1) и `marjan.600`, добавлен `border.strong` для границ контролов (декоративный `komosh.400` даёт 2,35:1).
