# Презентация

- `deck.mjs` — слайды, `deck.css` — стили на токенах `packages/design-tokens`, `speech.md` — текст выступления (3 минуты).
- Сборка: `node presentation/build.mjs` → `presentation/teletau.pdf` (Chromium из Playwright веба, без окон);
  `--png <папка>` — ещё и PNG каждого слайда. Проверка геометрии: `node presentation/check-deck.mjs`.

## Откуда снимки (`shots/`)

Со стенда teletau.study — `node presentation/shots-web.mjs`: `landing-ba.png`, `dictionary.png`.

Демо-мир на моках — `TELETAU_SCREENS=1 TELETAU_SCREENS_DIR=<папка> pnpm --filter @teletau/web test:a11y`
(консоль — то же с `@teletau/console`):

| Файл | Снимок |
|---|---|
| `trail.png` | `m2/62-home-today.png` |
| `web-home.png` | `m2/33-home-1280.png` |
| `lesson-tiles.png`, `lesson-word.png`, `result.png` | `m2/05-lesson-tiles.png`, `m2/60-lesson-new-word.png`, `m2/13-result.png` |
| `lesson-almost.png` | `m2/09-lesson-input-almost.png` |
| `explain.png` | лист «Почему так?» взрослого (сценарий из `learn.spec.ts`, 390×844 @2x) |
| `streak.png`, `league.png`, `awards.png` | `m2/14-streak.png`, `m2/16-league.png`, `awards-profile-390.png` |
| `duel.png` | `m2/10-lesson-duel.png` |
| `teacher-home.png`, `teacher-progress.png` | `m2/walk-1280-home-one-class.png`, `m2/walk-1280-class-progress.png` |
| `ministry.png`, `fund.png` | консоль: `console-06-republic-1280.png`, `console-08-fund-1280.png` |
| `miniapp.png` | `m2/51-miniapp-trail-telegram.png` |

Мобильные — снимки тестов: `ios-trail.png` (iOS `trail-today`), `android-welcome.png` (Android).
