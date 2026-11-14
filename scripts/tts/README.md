# Синтез башкирской озвучки (content/audio/tts)

У 35 строк курса есть запись носителя (Wikimedia Commons, `content/audio`); остальные строки курса в
уроке и словаре молчали. Владелец разрешил синтез речи как фолбэк — модель
[Silero v5_cis_base_nostress](https://github.com/snakers4/silero-models) (многодикторная V5 CIS,
диктор `bak_aigul`, лицензия MIT — LICENSE_CIS в репозитории модели). Синтез ≠ запись носителя:
источник озвучки виден клиентам как `silero-tts-v5-cis` (content/sources.yaml), в поле `audio`
YAML остаётся только запись носителя.

Файлы лежат в `content/audio/tts/<слаг>.ogg` (Ogg Vorbis, 24 кГц, моно) и являются манифестом —
YAML курса не меняется. Слаг — `ttsSlug(normalize(ba))` из `scripts/lib/audio.mjs`: NFC → нижний
регистр → краевая пунктуация снята → пробелы в «-» → прочая пунктуация удалена. Строки с записью
носителя в синтез не попадают: запись всегда предпочтительнее.

## Пайплайн

1. `node scripts/tts/collect-slugs.mjs > manifest.json` — слаги строк курса без записи (нужна
   сборка `pnpm --filter @teletau/bashkir-text build`).
2. `python scripts/tts/generate.py manifest.json` — синтез (существующие файлы не трогает;
   `--force` — перегенерировать).
3. Дальше файлы подхватывает общий пайплайн озвучки: `node scripts/check-content.mjs` (слаг
   соответствует строке, сирот нет), `pnpm audio` (копии в `apps/web/public/audio`), при изменении
   набора tts-файлов поднимите `version` в `content/course/ba-ru/course.yaml` и выполните
   `pnpm --filter @teletau/api content:import`.

## Окружение генерации (в репозиторий не входит)

Генерация запускается вручную, на машине разработчика; в репозитории — только готовые ogg-файлы.

```sh
python3.13 -m venv <каталог вне репо>/tts-venv
<каталог>/tts-venv/bin/pip install torch numpy soundfile omegaconf
```

Модель (~60 МБ) скачивается в кеш torch.hub при первом запуске. Синтез идёт на CPU и занимает
доли секунды на строку.
