# xp — мёд («бал»)

Эталон — `packages/domain-rules` (`src/xp.ts`), раннер — `pnpm vectors`. Методика — `docs/02` §6. Числа стартовые, калибруются в M4
и на пилоте (`docs/plans/M2.md` §6); изменение чисел — новая `version` набора.

## `lesson.json` (v1) — `lessonHoney({ kind, firstAttempts, completionToday })`

→ `{ base, firstTry, multiplier, total }`

- `kind` — вид узла: `lesson`, `place_test` («Испытание места» — как урок), `help_language` («Помоги языку» — мёда за урок нет,
  `base = 0`, `firstTry = 0`: там только голоса, их мёд — в `vote.json`).
- `firstAttempts` — вердикт **первой** попытки по каждому упражнению урока (`correct`, `almost`, `typo`, `wrong`, `recorded` — дуэль).
- `base` = 10 (у `help_language` — 0).
- `firstTry` = число первых попыток `correct`, `almost` или `typo` (они засчитываются); `wrong` и `recorded` (дуэли не оцениваются) — 0.
- `completionToday` — порядковый номер этого завершения этого урока за текущие сутки по Уфе (1 — первое за сутки).
  `multiplier` = 1 при 1, 0.5 при 2, 0 при 3 и больше. Первое завершение в другой день — снова 1.
- `total` = ⌊(`base` + `firstTry`) × `multiplier`⌋.

## `vote.json` (v1) — `voteHoney({ choice, decision })`

→ `{ status: "pending" | "final" | "none", amount }`

- `choice` — `a`, `b`, `both` («Оба подходят»), `skip` («Не знаю»).
- `decision` — `null`, пока решения нет (`voting` или `escalated` по duel-v0), иначе `{ accepted: [...] }` — принятые варианты
  (`consensus/duel-v0.json`, поле `accepted`).
- `skip` → `none`, 0 — всегда.
- Без решения → `pending`, 3 («мёд созревает»).
- С решением → `final`: 3 при согласии, 1 при несогласии. Согласие: для `a`/`b` — выбранный вариант среди принятых; для `both` —
  приняты оба (иначе «оба» выигрывал бы всегда). В журнале `xp_ledger` голос сначала пишется как `pending`, при решении — `final`.
