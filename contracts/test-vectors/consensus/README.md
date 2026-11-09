# consensus — дуэль v0

Эталон — `packages/domain-rules` (`src/duel-v0.ts`), раннер — `pnpm vectors`. Решение — ADR 0019 «Дуэль v0 до Consensus Engine»,
группы голосов — `docs/03-consensus-engine.md` §4a. В M4 правила заменит Consensus Engine; голоса неизменяемы (правило 9), поэтому
состояния пересчитаются из журнала `judgments`. Каждое состояние помнит `rules_version` = `duel-v0`.

## `duel-v0.json` (v1) — `duelV0({ votes })`

Вход — голоса за пару вариантов `a`/`b` одного исходника в порядке времени: `{ voter, group, choice }`,
`group` ∈ `child | adult | teacher | expert`, `choice` ∈ `a | b | both | skip`.

→ `{ status, accepted, main, decidedBy, childrenPrefer, weighted, counted }`

1. У каждого участника (`voter`) учитывается только последний голос.
2. **Эксперт решает окончательно.** Если есть голос эксперта с `a`, `b` или `both` (берётся последний такой): `status` = `accepted`,
   `decidedBy` = `expert`; `a`/`b` → `accepted` = [выбор], `main` = выбор; `both` → `accepted` = [`a`, `b`], `main` = null.
   `skip` эксперта — не решение. Голоса экспертов не входят в `weighted` и `counted`.
3. **Веса**: ребёнок 1, взрослый 2, учитель 3. `weighted.a` = Σ вес × (1 за `a`, 0,5 за `both`), `weighted.b` — так же;
   `skip` — 0. `counted` — число голосов `a`, `b`, `both` (не экспертов).
4. Нет ни одного голоса `a`/`b`/`both` от учителей или взрослых → `voting` (голосами одних детей не принимается).
5. **Большинство группы** (учителя, взрослые, дети): голоса группы `a` против `b` без весов, `both` — по 0,5 обоим, `skip` не
   считается; ничья — большинства нет. Большинства учителей и взрослых есть и различаются → `escalated`.
6. Иначе `counted` ≥ 3 и |`weighted.a` − `weighted.b`| ≥ 2 → `accepted`, `decidedBy` = `rule`, `main` — лидер,
   `accepted` = [лидер].
7. Иначе → `voting`.
8. `childrenPrefer`: при `accepted` с `main` ≠ null — если большинство детей есть и это другой вариант, то он (`a` или `b`,
   метка варианта `children_prefer`); иначе null. При `voting` и `escalated` — null.
9. При `voting` и `escalated`: `accepted` = [], `main` = null, `decidedBy` = null.
