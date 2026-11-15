# Синтез башкирской озвучки (content/audio/tts)

Строкам курса без записи носителя (`audio` в YAML) озвучку даёт синтез речи: модель
[Silero v5_cis_base_nostress](https://github.com/snakers4/silero-models), диктор `bak_aigul`, лицензия
MIT (LICENSE_CIS в репозитории модели). Синтез ≠ запись носителя: источник озвучки виден клиентам как
`silero-tts-v5-cis` (content/sources.yaml), в поле `audio` YAML остаётся только запись носителя.

Файлы лежат в `content/audio/tts/<слаг>.ogg` (Ogg Vorbis, 24 кГц, моно, VBR q4) и являются манифестом —
YAML курса не меняется. Слаг — `ttsSlug(normalize(ba))` из `scripts/lib/audio.mjs`: NFC → нижний
регистр → краевая пунктуация снята → пробелы в «-» → прочая пунктуация удалена. Строки с записью
носителя в синтез не попадают: запись всегда предпочтительнее.

## Пайплайн

1. `node scripts/tts/collect-slugs.mjs > manifest.json` — слаги строк курса без записи (нужна
   сборка `pnpm --filter @teletau/bashkir-text build`).
2. `node scripts/tts/generate.mjs manifest.json` — синтез (существующие файлы не трогает;
   `--force` — перегенерировать, `--out <каталог>` — писать в другой каталог, `--jobs <n>` — число потоков).
3. Дальше файлы подхватывает общий пайплайн озвучки: `node scripts/check-content.mjs` (слаг
   соответствует строке, сирот нет), `pnpm audio` (копии в `apps/web/public/audio`), при изменении
   набора tts-файлов поднимите `version` в `content/course/ba-ru/course.yaml` и выполните
   `pnpm --filter @teletau/api content:import`.

## Как устроен генератор

Генерация офлайновая, на машине разработчика; в репозитории — код и готовые ogg-файлы. Зависимости
ставит `pnpm install` (кодер Vorbis — `wasm-media-encoders`, libvorbis в WebAssembly), системные
программы не нужны.

- `torch-package.mjs` — чтение пакета модели PyTorch (`.pt` — zip с pickle и сырыми тензорами) без
  PyTorch: конфигурация (символы, дикторы) и веса. Код TorchScript из пакета не исполняется.
- `silero.mjs` — сеть на JavaScript, повторяет TorchScript пакета (`.data/ts_code/code/__torch__/silero_vocoder/jit_model.py`):
  текст → символы → длительности и высота тона (трансформеры) → кодировщик FastPitch → регулятор длин →
  декодер HourGlass → мел-спектр → вокодер Vocos (ISTFT, 48 кГц) → полоса 0 банка PQMF (24 кГц).
- `generate.mjs` — манифест → `<слаг>.ogg`, потоки `worker_threads`.

Модель (~92 МБ) скачивается при первом запуске с `models.silero.ai` в кеш вне репозитория —
`$TELETAU_TTS_CACHE` или `~/.cache/teletau/tts/` (`--model <файл>` — свой путь); SHA-256 сверяется
с `SILERO_MODEL` в `silero.mjs`. Синтез идёт на CPU, несколько секунд на строку.

Выход совпадает с эталонной реализацией Silero на PyTorch, которой синтезированы файлы в
`content/audio/tts`: у всех 172 строк та же длина в сэмплах; после кодирования тем же libvorbis
расхождение — от −27 дБ к сигналу и ниже (медиана −46 дБ, у 37 строк звук совпадает побитно), это
ниже шума самого кодека (≈ −11…−21 дБ). Проверка — `scripts/test/tts.test.mjs` (тест с моделью
запускается, когда она есть в кеше).
