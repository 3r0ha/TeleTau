# Черновик, не контент

Этот каталог не импортируется. `scripts/check-content.mjs` его пропускает. Его можно удалить целиком: контент курса от него не зависит.

Здесь лежат рабочие материалы Ч1 (M2): по ним видно, откуда взята каждая башкирская строка, и их можно пересобрать.

- `cache/` — сохранённые копии открытых источников, в том числе `wikidata/` и `commons/`. Реестр источников — `content/sources.yaml`.
  - `wv-ru.txt` — Викигид «Башкирский разговорник», oldid 761421.
  - `ba-etiket.txt` — ba.wikipedia «Башҡорттарҙың телмәр этикеты», oldid 1051009.
  - `tatoeba-bak.json` — 290 предложений bak→rus.
  - `wiktba/`, `wikt/` — статьи русского Викисловаря.
  - `rujourn.html` — копия Wayback Machine.
  - `hf/` — ответы Datasets Viewer `/filter` по корпусу AigizK.
- `tools/sources-lib.mjs` — функции-«атомы». Атом берёт башкирскую строку только если она посимвольно есть в копии источника, иначе бросает исключение. Затем он строит `{ ba: normalize(raw), raw?, ru, source, review }`.
- `tools/content-spec.mjs` — уроки и дуэли юнита 1 из атомов.
- `tools/build-content.mjs` — пишет `content/course/**` и `content/corpus/duels/**`. Запуск: `node content/_staging/tools/build-content.mjs`, затем `node scripts/check-content.mjs`. Выход детерминирован.
- `tools/hfbatch.mjs`, `hfquick.mjs`, `tatoeba.mjs`, `wiktsec.mjs` — как собирался кеш.
- `tools/commons-info.mjs`, `tools/fetch-audio.mjs` — записи произношения с Wikimedia Commons: сведения о файлах лежат в `cache/commons/info.json`, копии — в `content/audio/` (SHA-1 сверяется с Commons). Генератор прикрепляет `audio` только к словам, у которых есть скачанная копия.

После правок носителя (поле `review`) YAML в `content/` правится вручную. Генератор тогда больше не запускать: он перезапишет вердикты.
