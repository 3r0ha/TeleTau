# 02. AI и языковые технологии для башкирского языка: технический ресерч

**Проект:** «Башкирская языковая школа» (веб + iOS/SwiftUI + Android/Compose + Telegram-бот, AI-провайдер — GigaChat)
**Статус фактов:** у каждого факта есть ссылка. Если подтвердить не удалось, так и написано: «не подтверждено». Всё, что посчитано или проверено мной локально, помечено **[замер]**: глифы шрифтов, ICU-сортировка, токенизация. Данные, полученные от другого агента и не перепроверенные мной, помечены **[данные другого агента]**.

---

## 0. Резюме

1. **GigaChat API.** В API доступны GigaChat 2 Lite/Pro/Max: контекст 128K, есть функции, вызов text2image и batch ([модели](https://developers.sber.ru/docs/ru/gigachat/models), [2 Max](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-2-max)). Кроме того, есть **GigaChat 3 Ultra**, но только для физлиц во freemium ([страница модели](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-3-ultra)). С 16–17.07.2026 у API единый базовый URL `https://api.giga.chat` ([changelog](https://developers.sber.ru/docs/ru/gigachat/changelog), [авторизация](https://developers.sber.ru/docs/ru/gigachat/api/authorization)). Structured output через `response_format: json_schema` со `strict` появился в июне 2026 ([гайд](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output)). Параллельный function calling в `/v2` работает с 06.10.2026 ([changelog](https://developers.sber.ru/docs/ru/gigachat/changelog)).
2. **Цены у Сбера** (pay-as-you-go, с НДС): Lite — 65 ₽, Pro — 500 ₽, Max — 650 ₽ за 1М токенов. Асинхронный режим стоит вдвое дешевле. Минимальный платёж — 600 ₽ в месяц ([тарифы юрлиц](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)). Физлица получают freemium на **365 млн токенов на 12 месяцев**, но работают **в 1 поток** ([тарифы физлиц](https://developers.sber.ru/docs/ru/gigachat/tariffs/individual-tariffs), [лимиты](https://developers.sber.ru/docs/ru/gigachat/limitations)). С 01.09.2026 **новые клиенты платят через Cloud.ru** ([тарифы юрлиц](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)). Там GigaChat 3.5 Ultra стоит 96/289 ₽ за 1М входных/выходных токенов ([CNews/ComNews](https://www.comnews.ru/content/246519/2026-07-22/2026-w30/1018/biznesu-stala-dostupna-odna-samykh-moschnykh-russkoyazychnykh-modeley-gigachat-35-ultra)), GigaChat 3 Lightning — 12,2 ₽ за 1М, GigaChat 3 Pro — 73/176 ₽ **[данные другого агента]**.
3. **Открытые веса GigaChat под MIT.** GigaChat 3.1 Ultra (702B-A36B), 3.1 Lightning (10B-A1.8B) и 3.5 Ultra (432B-A28B) лежат на Hugging Face ([3.1 Ultra](https://huggingface.co/ai-sage/GigaChat3.1-702B-A36B), [3.1 Lightning](https://huggingface.co/ai-sage/GigaChat3.1-10B-A1.8B), [3.5 Ultra](https://huggingface.co/ai-sage/GigaChat3.5-432B-A28B)). Lightning можно развернуть on-prem на одной GPU.
4. **Башкирский в GigaChat.** 10.04.2026 Сбер заявил поддержку 30+ языков народов России, башкирский назван явно, поддержка только текстовая ([iXBT](https://www.ixbt.com/news/2026/04/10/sber-obnovil-iipomoshnika-gigachat-dostupno-bolee-30-jazykov-narodov-rossii-i-stran-sng.html)). **Независимых бенчмарков GigaChat на башкирском нет (не подтверждено).** Распространяется ли улучшение на API-модели GigaChat 2, тоже не подтверждено.
5. **Токенизация [замер].** На 439 параллельных предложениях токенизатор GigaChat 3.x тратит на башкирский текст **в 1,78 раза больше токенов**, чем на эквивалентный русский: 2,04 символа на токен против 3,71. Все оценки стоимости надо умножать на этот коэффициент.
6. **Машинный перевод.** Лучший опубликованный результат рус→баш — chrF++ **52,67**: NLLB-1.3B + QLoRA, LoResMT 2026 ([ACL](https://aclanthology.org/2026.loresmt-1.18/)). Но у NLLB лицензия **CC-BY-NC**: это «research model, not for production» ([HF](https://huggingface.co/facebook/nllb-200-distilled-600M)). Коммерчески чистые альтернативы: **M2M-100 418M, дообученная рус→баш (MIT, chrF++ 48,80)** и **Marian 77M (Apache-2.0, chrF++ 43,15, работает на CPU)** ([Voldis/m2m100-rus-bak](https://huggingface.co/Voldis/m2m100-rus-bak), [Voldis/marian-rus-bak](https://huggingface.co/Voldis/marian-rus-bak)). У MADLAD-400 лицензия Apache-2.0 и есть `ba`, но качество на башкирском не подтверждено. OPUS-MT для башкирского непригоден: BLEU 3–8.
7. **Данные.** Главный открытый параллельный корпус — AigizK: **1 198 220 пар, CC-BY-4.0** ([HF](https://huggingface.co/datasets/AigizK/bashkir-russian-parallel-corpora)). В Tatoeba всего **435** башкирских предложений ([Tatoeba](https://tatoeba.org/en/stats/sentences_by_language)). В башкирской Википедии **64 314** статей ([статистика](https://ba.wikipedia.org/wiki/Махсус:Статистика)).
8. **Речь.** Common Voice 25.0 для башкирского: **268,7 ч, из них 258,8 ч валидировано, 930 голосов, CC0** ([HF-зеркало датащита](https://huggingface.co/datasets/kamachkin/CVbashkir)). Лучшая открытая ASR — **GigaAM-Bashkir-CV25 (MIT, WER 7,73% на тесте CV25)** ([HF](https://huggingface.co/AigizK/GigaAM-Bashkir-CV25)). Лучший открытый TTS для коммерции — **Silero `v5_cis_base` под MIT, 5 башкирских голосов** ([GitHub](https://github.com/snakers4/silero-models)). Ни SaluteSpeech, ни API Yandex SpeechKit башкирский **не поддерживают** ([SaluteSpeech](https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/ssml/language), [SpeechKit](https://aistudio.yandex.ru/docs/ru/speechkit/stt/models)).
9. **Ввод и типографика.** **На iOS встроенной башкирской раскладки нет** ([Apple](https://www.apple.com/ios/feature-availability/)), а Gboard башкирский поддерживает ([Google](https://support.google.com/gboard/answer/6380730?hl=en)). Шрифты Manrope и Unbounded в версиях с Google Fonts **не содержат** башкирских букв **[замер]**. ICU/CLDR не знает башкирской сортировки: Ә оказывается после А, а должна стоять после Э **[замер]**. Нужна собственная tailoring-правка.
10. **Оценка качества и алгоритмы.** COMET для башкирского ненадёжен: XLM-R не покрывает `ba` ([COMET](https://github.com/Unbabel/COMET)). Метрика — chrF++ плюс оценка людьми. Для агрегации голосов подходит crowd-kit (Apache-2.0: Dawid–Skene, GLAD, Bradley–Terry) ([GitHub](https://github.com/Toloka/crowd-kit)), для интервальных повторений — FSRS (MIT; есть TS, Swift и JVM-реализации).
11. **Стоимость на 1 активного пользователя в месяц.** Базовый сценарий — около 155 тыс. токенов. Это **≈2 ₽ на GigaChat 3 Lightning (Cloud.ru)**, ≈10 ₽ на Lite у Сбера, ≈7 ₽ при смешанной схеме Lightning + 3.5 Ultra и ≈100 ₽, если всё гонять на Max. Допущения — в разделе «Рекомендации».

---

## A. GigaChat API

### A1. Модели

| Модель | ID в API | Контекст | Модальности | Особенности | Источник |
|---|---|---|---|---|---|
| GigaChat 2 Lite | `GigaChat` / `GigaChat-2` | 128 000 | вход: текст; выход: текст + изображения | функции, batch, встроенные text2image / text2model3d / обработка документов | [страница](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-2-lite) |
| GigaChat 2 Pro | `GigaChat-Pro` / `GigaChat-2-Pro` | 128K (по аналогии с линейкой, на странице Pro не проверено) | — | — | [тарифы](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs) |
| GigaChat 2 Max | `GigaChat-Max` / `GigaChat-2-Max` | 128 000 | вход: текст, изображения, аудио; выход: текст и изображения | функции, анализ изображений и аудио, batch. Бенчмарки по данным Сбера: MMLU 0,86, ruMMLU 0,80, IFEval-ru 0,83 | [страница](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-2-max) |
| GigaChat 3 Ultra | `GigaChat-3-Ultra` | не указан (не подтверждено) | — | только физлица во freemium. На платных тарифах Сбера пока недоступна (страница от 17.07.2026) | [страница](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-3-ultra) |
| GigaChat 3.5 Ultra | через Cloud.ru (Evolution Foundation Models, OpenAI-совместимый API) | не указан | — | 96 ₽ / 289 ₽ за 1М вход/выход, с 22.07.2026 | [ComNews](https://www.comnews.ru/content/246519/2026-07-22/2026-w30/1018/biznesu-stala-dostupna-odna-samykh-moschnykh-russkoyazychnykh-modeley-gigachat-35-ultra) |
| GigaChat 3.5 Reasoning | через Cloud.ru | не указан | — | 96 ₽ / 289 ₽, с 23.09.2026 | [ComNews](https://www.comnews.ru/content/247512/2026-09-23/2026-w39/1018/cloudru-otkryl-biznesu-dostup-k-novoy-modeli-gigachat-35-reasoning) |
| Embeddings, Embeddings-2, EmbeddingsGigaR, Embeddings-3B-2025-09 | одноимённые | у GigaR «большой контекст», без цифр | — | векторизация | [модели](https://developers.sber.ru/docs/ru/gigachat/models) |

- Модели первого поколения отключены, сообщение об этом в changelog от 09.07.2025 ([changelog](https://developers.sber.ru/docs/ru/gigachat/changelog)). Линейка GigaChat 2 анонсирована 13.03.2025.
- Документация оценивает русский токен примерно в 3–4 символа ([лимиты](https://developers.sber.ru/docs/ru/gigachat/limitations)). **[замер]** Токенизатор открытых GigaChat 3.1/3.5 даёт 3,71 символа на токен для русского и **2,04 — для башкирского**: в 1,78 раза больше токенов на тот же смысл. Метод: 439 параллельных пар из [корпуса AigizK](https://huggingface.co/datasets/AigizK/bashkir-russian-parallel-corpora), `tokenizer.json` взят из [ai-sage/GigaChat3.1-10B-A1.8B](https://huggingface.co/ai-sage/GigaChat3.1-10B-A1.8B). Токенизатор API-моделей GigaChat 2 может отличаться (**не подтверждено**). Для прода коэффициент стоит перемерить эндпоинтом `POST /tokens/count`. Для сравнения, у Qwen3: 1,72× и 1,48 символа на токен для башкирского.

### A2. Возможности API

- **Function calling.** Есть у всех моделей GigaChat 2 ([2 Lite](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-2-lite), [2 Max](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-2-max)). С 06.10.2026 в `POST /v2/chat/completions` есть **параллельный вызов функций**, он доступен с GigaChat 3 Ultra. С 22.05.2026 в сообщениях ассистента есть поле `function_call` ([changelog](https://developers.sber.ru/docs/ru/gigachat/changelog)).
- **Structured output / JSON.** `response_format: {type: "json_schema", schema, strict: true}` плюс `required`. В `/v2` параметры задаются в `model_options.response_format`. Python SDK строит схему из Pydantic (`chat.parse()`, бета), стриминг поддерживается ([гайд](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output), [SDK](https://github.com/ai-forever/gigachat)). Функция появилась 15–18.06.2026 сначала для адреса `api.giga.chat` клиентов «Салют для Бизнеса» ([changelog](https://developers.sber.ru/docs/ru/gigachat/changelog)). Доступна ли она на всех моделях и тарифах после перехода на единый URL, **не подтверждено**.
- **Стриминг** есть во всех трёх официальных SDK ([using-sdks](https://developers.sber.ru/docs/ru/gigachat/guides/using-sdks)).
- **Batch / асинхронный режим.** `POST /batches` описан в changelog с 06.06.2025. Асинхронный тариф вдвое дешевле синхронного ([тарифы](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)).
- **Генерация изображений.** Вызывается встроенной функцией `text2image` при `function_call: "auto"`. Ответ приходит как `<img src="file_id">` в формате JPG, скачивается через `GET /files/{id}/content` ([гайд](https://developers.sber.ru/docs/ru/gigachat/guides/images-generation)). **Документация не указывает, какая версия Kandinsky под капотом (не подтверждено).**
- **Прочее.** Подсчёт токенов и экономия на кешированных токенах описаны 03.03.2025. Совместимость с OpenAI SDK описана 03.02.2025. Есть `POST /ai-check` для детекции AI-текста, 0,5 ₽ за 1000 токенов ([changelog](https://developers.sber.ru/docs/ru/gigachat/changelog), [тарифы](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)).

### A3. Авторизация и сертификаты

- Схема такая: **Authorization key** (Basic) → `POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth` с заголовками `RqUID` (UUID v4) и `scope` → **access token на 30 минут**, в ответе `expires_at`. Лимит на получение токенов — 10 запросов в секунду ([авторизация](https://developers.sber.ru/docs/ru/gigachat/api/authorization)).
- Значения scope: `GIGACHAT_API_PERS` — физлица, `GIGACHAT_API_B2B` — ИП и юрлица по предоплате (пакеты), `GIGACHAT_API_CORP` — ИП и юрлица по постоплате (pay-as-you-go) ([там же](https://developers.sber.ru/docs/ru/gigachat/api/authorization)).
- Базовый URL: с 17.07.2026 для всех используется `https://api.giga.chat`. Старый `gigachat.devices.sberbank.ru` пока работает для действующих подключений, но будет выведен из эксплуатации ([там же](https://developers.sber.ru/docs/ru/gigachat/api/authorization)).
- **Сертификаты НУЦ Минцифры.** Нужны `russian_trusted_root_ca_pem.crt` и `russian_trusted_sub_ca_pem.crt` с Госуслуг. В Python их передают через `ca_bundle_file` или `GIGACHAT_CA_BUNDLE_FILE`, в Node — через `NODE_EXTRA_CA_CERTS` ([сертификаты](https://developers.sber.ru/docs/ru/gigachat/certificates), [SDK](https://github.com/ai-forever/gigachat)). Выдаёт ли `api.giga.chat` сертификат публичного CA, **не подтверждено**. OAuth-хост `ngw.devices.sberbank.ru` по-прежнему фигурирует в SDK.
  - Практический вывод: **GigaChat вызывается только с нашего бэкенда.** Мобильные клиенты не должны хранить Authorization key и не обязаны доверять корню НУЦ. В примерах Сбера встречаются `verify_ssl_certs=False` и `NODE_TLS_REJECT_UNAUTHORIZED=0`, повторять это в проде нельзя.

### A4. Тарифы

**Физлица** (действуют с 01.09.2026 для текущих клиентов) ([источник](https://developers.sber.ru/docs/ru/gigachat/tariffs/individual-tariffs)):
- Freemium на 12 месяцев, всего 365 000 000 токенов: Lite — 250М, Pro — 40М, Max — 25М, **Ultra (`GigaChat-3-Ultra`) — 50М**. Генерация идёт в один поток. На портале написано про «ежегодное возобновление» ([портал](https://developers.sber.ru/portal/products/gigachat-api)).
- Пакеты на 1 месяц: Lite 20М — 1 300 ₽, Pro 3М — 1 500 ₽, Max 3М — 1 950 ₽, Embeddings 50М — 700 ₽.

**Юрлица и ИП** ([источник](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs), цены с НДС):

| Модель | Pay-as-you-go, синхронно (₽ за 1М) | Асинхронно (₽ за 1М) | Пакеты «Салют для Бизнеса» (действуют 12 мес.) |
|---|---|---|---|
| Lite | 65 | 32,5 | 300М — 19 500 ₽ … 1 млрд — 65 000 ₽ |
| Pro | 500 | 250 | 50М — 25 000 ₽ … 1 млрд — 500 000 ₽ |
| Max | 650 | 325 | 30М — 19 500 ₽ … 1 млрд — 650 000 ₽ |
| Embeddings | 14 | 7 | 1 млрд — 14 000 ₽ |

- Минимальный платёж по pay-as-you-go — **600 ₽ в месяц**. Если запросов не было, платить не нужно.
- **С 01.09.2026 новые клиенты и клиенты, которые раньше не покупали пакеты, оплачивают модели через cloud.ru** ([источник](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)). Цены Cloud.ru: GigaChat 3.5 Ultra и 3.5 Reasoning — 96/289 ₽ за 1М вход/выход ([ComNews 22.07](https://www.comnews.ru/content/246519/2026-07-22/2026-w30/1018/biznesu-stala-dostupna-odna-samykh-moschnykh-russkoyazychnykh-modeley-gigachat-35-ultra), [ComNews 23.09](https://www.comnews.ru/content/247512/2026-09-23/2026-w39/1018/cloudru-otkryl-biznesu-dostup-k-novoy-modeli-gigachat-35-reasoning)). GigaChat 3 Lightning — 12,2 ₽ за 1М, GigaChat 3 Pro — 73/176 ₽, GigaEmbedding — 3,32/32,22 ₽ **[данные другого агента; страницу прайса Cloud.ru сам я не открывал]**. Включён ли НДС в цены Cloud.ru, **не подтверждено**.
- Контекст рынка: с октября 2025 по август 2026 GigaChat Lite подешевел с 0,20 до примерно 0,065–0,07 ₽ за 1000 токенов, Pro — с 1,50 до 0,50 ₽ ([AdIndex со ссылкой на РБК](https://adindex.ru/news/digital/2026/08/25/348304.phtml)).

### A5. Rate limits и параллельность

- У физлиц **1 поток**, и на freemium, и на пакетах. У юрлиц и ИП **по умолчанию 10 потоков**, увеличить можно по письму на gigachat@sberbank.ru ([лимиты](https://developers.sber.ru/docs/ru/gigachat/limitations)).
- Ограничения на RPS и размер файлов в документации не указаны (**не подтверждено**). Для прода нужен **договор юрлица**: на физлице в один поток продакшн не построить.

### A6. Официальные SDK

| Язык | Пакет | Версия, дата | Лицензия | Источник |
|---|---|---|---|---|
| Python | `gigachat` | 0.2.4, 30.10.2026 | MIT | [PyPI](https://pypi.org/project/gigachat/), [GitHub](https://github.com/ai-forever/gigachat) |
| Python / LangChain | `langchain-gigachat` | 0.5.1, 04.05.2026 | MIT | [PyPI](https://pypi.org/project/langchain-gigachat/) |
| JS/TS | `gigachat` (npm) | 0.0.21 | ISC (по метаданным npm) | [npm](https://www.npmjs.com/package/gigachat), [using-sdks](https://developers.sber.ru/docs/ru/gigachat/guides/using-sdks) |
| Java | `chat.giga:gigachat-java:0.1.18` | — | — | [using-sdks](https://developers.sber.ru/docs/ru/gigachat/guides/using-sdks) |
| Kotlin / Swift | **официальных SDK нет** (не найдено) | — | — | [using-sdks](https://developers.sber.ru/docs/ru/gigachat/guides/using-sdks) |

Для Kotlin-бэкенда подойдёт Java SDK. Для мобильных клиентов нужен только наш собственный API. Через Cloud.ru GigaChat отдаётся по OpenAI-совместимому API ([ComNews](https://www.comnews.ru/content/246519/2026-07-22/2026-w30/1018/biznesu-stala-dostupna-odna-samykh-moschnykh-russkoyazychnykh-modeley-gigachat-35-ultra)), так что подойдёт любой OpenAI-клиент.

### A7. Обработка данных, on-prem, регуляторика (технический аспект)

- Сбер заявляет: «по умолчанию мы не храним и не используем ваши запросы и ответы для дообучения модели», «все данные хранятся на серверах в РФ» ([портал](https://developers.sber.ru/portal/products/gigachat-api)). Независимые разборы указывают, что в пользовательском соглашении нет отдельного пункта про дообучение ([SecurityLab](https://www.securitylab.ru/analytics/561047.php), [vc.ru](https://vc.ru/ai/3053139-gigachat-i-analiz-dokumentov)). Юридическую часть оценивает другой агент.
- **On-prem.** Открытые веса под MIT (см. A8) позволяют развернуть модель в своём контуре. Официальных условий on-prem-поставки проприетарного GigaChat 2 Max в источниках нет (**не подтверждено**; на Хабре такая возможность упоминается: [Habr](https://habr.com/ru/articles/924352)).
- Cloud.ru заявляет соответствие инфраструктуры требованиям к ГИС и КИИ, а также предлагает Guardrails Filter ([ComNews](https://www.comnews.ru/content/247512/2026-09-23/2026-w39/1018/cloudru-otkryl-biznesu-dostup-k-novoy-modeli-gigachat-35-reasoning)). С 01.03.2026 действует приказ ФСТЭК № 117 с отдельными требованиями к ИИ-сервисам **[данные другого агента]**. Это повод заранее предусмотреть журналирование промптов и ответов и фильтрацию контента.

### A8. Открытые веса GigaChat

| Модель | Параметры (всего / активных) | Лицензия | Контекст | Железо | Источник |
|---|---|---|---|---|---|
| GigaChat 3 Ultra Preview / Lightning (конец 2025) | 702B / 10B-A1.8B | MIT | Lightning — до 256K | Lightning base в 4 бит работает на T4 (≈5,8 ГБ VRAM). FP8-instruct требует compute capability 8.9+ (RTX 4090, H100) | [Habr](https://habr.com/ru/articles/985976/) |
| **GigaChat 3.1 Lightning** | 10B / 1,8B (MoE) | MIT | 256K по данным СМИ, в карточке не указан | 1×H100: 3 958 ток/с при concurrency 32 (FP8 + MTP). Движки: vLLM, SGLang, Transformers; есть GGUF | [HF](https://huggingface.co/ai-sage/GigaChat3.1-10B-A1.8B), [Digital Razor](https://digital-razor.ru/media/news/software/sber-gigachat-3-1-ultra-lightning/) |
| GigaChat 3.1 Ultra | 702B / 36B | MIT | 256K по данным СМИ | кластер: пример SGLang на 2 нодах, TP16/EP16 | [HF](https://huggingface.co/ai-sage/GigaChat3.1-702B-A36B) |
| GigaChat 3.5 Ultra (06.07.2026) | 432B / 28B, гибрид MLA + линейное внимание (GatedDeltaNet) | MIT | не указан | примеры с TP=8 (8 GPU), FP8, bf16, GGUF | [HF](https://huggingface.co/ai-sage/GigaChat3.5-432B-A28B), [vc.ru](https://vc.ru/ai/3027960-gigachat-3-5-ultra-ot-sbera) |

- Языки предобучения: «10 языков» ([HF](https://huggingface.co/ai-sage/GigaChat3.1-702B-A36B)). На Хабре явно названы ru, en, zh, ar, uz, kk. **Башкирского в карточках моделей нет** ([Habr](https://habr.com/ru/articles/985976/)).
- Lightning 10B-A1.8B — реальный кандидат для дешёвых задач на своём железе: классификация, нормализация, черновые подсказки. Качество на башкирском **не подтверждено**, его нужно мерить на собственном eval-наборе.

### A9. Программы Сбера (токены, гранты)

- Freemium на 365М токенов в год для физлиц — по сути бесплатная песочница для разработки ([портал](https://developers.sber.ru/portal/products/gigachat-api)).
- В 2023 году действовала программа бесплатного доступа для некоммерческих проектов, до 1М токенов в месяц ([sber.pro](https://sber.pro/publication/sber-otkryl-dostup-k-gigachat-api-dlya-nekommercheskogo-ispolzovaniya/)). **Действует ли она в 2026 году, не подтверждено.**
- Сбер ведёт акселератор Sber500 с треком внедрения GigaChat. Есть ли в нём токены или гранты, **не подтверждено**.
- Отдельной образовательной или госпрограммы с бесплатными токенами в 2026 году **не найдено**. Регион: Глава РБ даёт гранты студенческим командам, которые делают цифровые продукты для родных языков. Треки лингвистического ИИ запускаются в Стартап-студии, «Точке кипения — Уфа» и студии «Муха». Госпрограмма по языкам на 2026 год — 778,2 млн ₽ ([СР-газета/Башинформ](https://srgazeta.ru/articles/aktualno/2026-09-10/bashkiriya-stanet-vserossiyskim-tsentrom-tsifrovogo-razvitiya-rodnyh-yazykov-4808689)). Сотрудничество региона с Яндексом и Сбером в области ASR и MT упомянуто там же. Рекомендую запросить у Сбера и Минцифры РБ партнёрские токены под этот проект.

---

## B. Насколько LLM знают башкирский

- **Заявление Сбера (10.04.2026).** «ГигаЧат» лучше понимает и пишет тексты на 30+ языках народов России и СНГ, башкирский назван явно, речь только о тексте. Данные собирались с «Домом народов России», «Рувики», региональными академиями наук и НКО. **Методика оценки не раскрыта** ([iXBT](https://www.ixbt.com/news/2026/04/10/sber-obnovil-iipomoshnika-gigachat-dostupno-bolee-30-jazykov-narodov-rossii-i-stran-sng.html), [Ведомости](https://www.vedomosti.ru/technology/news/2026/04/10/1189462-gigachat-nachal-podderzhivat)). Речь идёт об ассистенте. Касается ли это моделей GigaChat 2 в API, **не подтверждено**. Логично предположить, что касается моделей поколения 3.x / 3.5 Ultra, на которых работает ассистент, но и это не подтверждено.
- **Практическое применение у самого Сбера.** В чате поддержки СберБанк Онлайн GigaChat незаметно переводит переписку. Башкирский вошёл в топ-5 языков народов России по обращениям за III квартал 2026 года после татарского, чувашского и бурятского ([Финансы Mail](https://finance.mail.ru/article/na-90-yazykah-sber-otvechal-polzovatelyam-v-chate-podderzhki-v-tom-chisle-na-tatarskom-i-elfijskom-69231143/)).
- **Независимые бенчмарки GigaChat на башкирском не найдены (не подтверждено).** TUMLU, основной бенчмарк по тюркским языкам, башкирский не включает ([arXiv 2502.11020](https://arxiv.org/abs/2502.11020)).
- **Академические данные по другим LLM:**
  - Arabov & Khaybullina, КФУ, 22.10.2026 ([arXiv 2610.31397](https://arxiv.org/html/2610.31397)). На башкирском сравнивались Phi-3-mini, Mistral-7B и **YandexGPT-5-Lite-8B**. YandexGPT лучше остальных: binary macro-F1 0,748 с continual pretraining; zero-shot 0,679; средняя оценка носителей языка **3,28** против 2,52 у Mistral и 2,22 у Phi-3. Fertility токенизаторов на башкирском — от 2,92 до 7,80 токенов на слово (разброс в 2,67 раза). GigaChat, GPT-4 и Qwen в работе не тестировались.
  - LoResMT 2026, рус→баш. Лучший результат дал **дообученный NLLB**, а не LLM: chrF++ 46,94 у Karpov ([arXiv 2602.04442](https://arxiv.org/abs/2602.04442)) и 52,67 у DevLake ([ACL](https://aclanthology.org/2026.loresmt-1.18/)). DeepSeek-V3.2 с retrieval выиграл только на чувашском. Вывод DevLake: решающий фактор — присутствие башкирского в предобучении. У NLLB 1.3B «из коробки» есть проблема: на выходе бывает арабская графика вместо кириллицы, её исправляли LoRA ([LoResMT 2026.20](https://aclanthology.org/2026.loresmt-1.20)).
  - **[замер]** Токенизатор GigaChat 3.x тратит на башкирский в 1,78 раза больше токенов, чем на русский. Это косвенно показывает, что специального башкирского словаря в токенизаторе нет.
- **Региональный контекст.** По сообщениям СМИ, DeepSeek, ГигаЧат и ИИ Яндекса «научились распознавать башкирский», метрик нет ([bash.news, 11.06.2026](https://bash.news/news/266397-neiroseti-naucilis-raspoznavat-baskirskii-iazyk)). РБ с конца 2025 года ведёт проект открытых датасетов башкирского языка для ИИ: межведомственная группа во главе с У. Кильсенбаевым, участвуют АН РБ, ИИЯЛ УФИЦ РАН и УУНиТ ([РесБаш](https://resbash.ru/news/tekhnologii/2026-05-23/oleg-li-obuchat-ii-bashkirskomu-yazyku-vklad-v-buduschee-yazyka-v-tsifrovoy-srede-4697303), [АБН24](https://abnews.ru/volga/news/bashkortostan/2026/8/8/v-bashkirii-nachali-sozdavat-dannye-dlya-obucheniya-ii-bashkirskomu-yazyku)). Лицензия этих датасетов **не подтверждена**. Проект может стать и партнёром, и источником данных.
- **YandexGPT и Алиса на башкирском.** Кроме статьи выше, публичных данных нет (**не подтверждено**).

**Вывод.** Для генерации и объяснений GigaChat на башкирском использовать можно, но **как источник истины — нельзя**. До запуска нужен собственный eval: 300–500 пар с эталонами от учителей, метрика chrF++ плюс экспертная оценка.

---

## C. Машинный перевод для башкирского

| Система | Поддержка `ba` | Лицензия / условия | Качество (рус→баш, если есть) | Источник |
|---|---|---|---|---|
| Яндекс Переводчик (приложение и API) | да, `ba` есть в списке языков API. В приложении для башкирского заявлены распознавание и синтез речи | коммерческий API Yandex Cloud / AI Studio, цена не проверена | публичных метрик нет | [AI Studio](https://aistudio.yandex.ru/docs/ru/translate/concepts/supported-languages), [СР-газета](https://srgazeta.ru/articles/aktualno/2026-09-10/bashkiriya-stanet-vserossiyskim-tsentrom-tsifrovogo-razvitiya-rodnyh-yazykov-4808689) |
| Google Translate | да, **с 27.06.2024** (пакет из 110 языков на PaLM 2) | потребительский сервис. Поддержка в Cloud Translation API **не подтверждена** | метрик нет | [Google Blog](https://blog.google/products/translate/google-translate-new-languages-2024/), [Google Help](https://support.google.com/translate/answer/15139004) |
| NLLB-200 (600M / 1.3B / 3.3B) | `bak_Cyrl` | **CC-BY-NC-4.0**, «research model, not for production», длина входа до 512 токенов | база для лучших систем LoResMT | [HF 600M](https://huggingface.co/facebook/nllb-200-distilled-600M), [HF 1.3B](https://huggingface.co/facebook/nllb-200-1.3B) |
| MADLAD-400 MT (3B / 7B / 10B) | да (`ba` среди 419 языков). В корпусе MADLAD-400 для `ba` 90 318 документов | **Apache-2.0** (модели), CC-BY-4.0 / ODC-BY (данные) | на `ba` **не подтверждено**: оценка шла только по 204 языкам | [HF](https://huggingface.co/google/madlad400-3b-mt), [датасет](https://huggingface.co/datasets/allenai/MADLAD-400) |
| Helsinki-NLP OPUS-MT | прямой модели rus↔bak нет. Есть мультиязычные `opus-mt-en-trk` и `trk-en` | Apache-2.0 | **eng→bak BLEU 7,6 / chrF 0,308; bak→eng BLEU 3,3 / chrF 0,185** на Tatoeba-test. Непригодно | [en-trk](https://huggingface.co/Helsinki-NLP/opus-mt-en-trk), [trk-en](https://huggingface.co/Helsinki-NLP/opus-mt-trk-en) |
| M2M-100 418M / 1.2B | да | **MIT** | — | [HF](https://huggingface.co/facebook/m2m100_418M) |
| **Voldis/nllb-1.3b-rus-bak** (DevLake) | рус→баш | адаптер под MIT, **но база NLLB — CC-BY-NC**, значит итог некоммерческий | **chrF++ 52,67**, лучший опубликованный | [HF](https://huggingface.co/Voldis/nllb-1.3b-rus-bak), [ACL](https://aclanthology.org/2026.loresmt-1.18/) |
| **Voldis/m2m100-rus-bak** | рус→баш | **MIT**, данные AigizK под CC-BY-4.0 | **chrF++ 48,80** | [HF](https://huggingface.co/Voldis/m2m100-rus-bak) |
| **Voldis/marian-rus-bak** | рус→баш, 77M, работает на CPU | **Apache-2.0** (база opus-mt-en-trk) | **chrF++ 43,15**, «может галлюцинировать» | [HF](https://huggingface.co/Voldis/marian-rus-bak) |
| Karpov: NLLB-600M + LoRA на синтетике | рус→баш | веса и датасет опубликованы. База NLLB, значит NC | chrF++ 46,94 | [arXiv](https://arxiv.org/abs/2602.04442), [ACL](https://aclanthology.org/2026.loresmt-1.17/) |
| zhursvlevy/t5-small-bashkir-russian | баш↔рус | **лицензия не указана**, использовать нельзя | — | [HF](https://huggingface.co/zhursvlevy/t5-small-bashkir-russian) |

Пояснения:
- Значения chrF++ из разных работ **напрямую не сравнимы**: тестовые наборы и условия у них разные. Официальный обзор LoResMT 2026 с общим лидербордом не найден (**не подтверждено**).
- Почти все открытые модели работают только в направлении **рус→баш**. Для баш→рус в открытом доступе есть только базовые NLLB, MADLAD и M2M. Публичных метрик для этого направления не найдено.
- Подборка моделей сообщества на HF (AigizK, slone, failed09, Voldis, BashkirNLPWorld): AigizK в основном занимается ASR и датасетами, переводчиков у него нет ([профиль AigizK](https://huggingface.co/AigizK)). Для проверки семантической близости пар есть `slone/LaBSE-shallow-distilled-bak` (Apache-2.0) ([HF](https://huggingface.co/slone/LaBSE-shallow-distilled-bak)).

---

## D. Корпуса и датасеты

| Ресурс | Объём | Лицензия | Комментарий | Источник |
|---|---|---|---|---|
| **AigizK/bashkir-russian-parallel-corpora** | **1 198 220 пар** | **CC-BY-4.0** | книги, Википедия, новости. Пары выравниваются алгоритмом и проверяются людьми (в т.ч. через бота `t.me/bashkort_translate_bot`) | [HF](https://huggingface.co/datasets/AigizK/bashkir-russian-parallel-corpora) |
| BorisTM/bak-rus-parallel | 9 768 889 пар: около 3,0М реальных и около 6,8М синтетических (обратный перевод NLLB-600M) | «смотрите лицензии источников». **Синтетика сделана моделью под NC** | реальная часть: AigizK, TIL-MT, OPUS NLLB, OPUS Wikimedia | [HF](https://huggingface.co/datasets/BorisTM/bak-rus-parallel) |
| OPUS ba-ru | корпуса NLLB, Wikimedia, Tatoeba и др. | разные | **объёмы не подтверждены**: opus.nlpl.eu был недоступен при проверке | [BorisTM card](https://huggingface.co/datasets/BorisTM/bak-rus-parallel) |
| Bashkir Web Corpus (BashkirNLPWorld) | 71 567 документов, около 46,9М токенов, 16 источников, 59% — Википедия | CC BY-SA 4.0 на компиляцию. Права на исходные тексты остаются у авторов. Доступ на HF по запросу (gated) | — | [arXiv](https://arxiv.org/html/2610.31397), [HF](https://huggingface.co/datasets/BashkirNLPWorld/bashkir-web-corpus) |
| Классификационные датасеты новостей (binary / multiclass / multilabel) | 17–22 тыс. документов | открытые (по статье) | — | [arXiv](https://arxiv.org/html/2610.31397) |
| metuKKhud/bashqort-raw | около 70 тыс. статей и 20,9М токенов из bashkir-corpus | заявлен MIT, **но источники — новостные сайты**, права сомнительны | — | [HF](https://huggingface.co/datasets/metuKKhud/bashqort-raw) |
| nevmenandr/bashkir-corpus | тексты для корпуса | GPL-3.0 | — | [GitHub](https://github.com/nevmenandr/bashkir-corpus) |
| MADLAD-400 (`ba`) | 90 318 документов | CC-BY-4.0 / ODC-BY | — | [HF](https://huggingface.co/datasets/allenai/MADLAD-400) |
| Башкирский национальный корпус (bashcorpus.ru) | **не подтверждено**: сайт не ответил (ECONNREFUSED) | не подтверждено | В параллельный корпус НКРЯ башкирский добавлен в 2015–2019 годах (по статье ИРЯ РАН, детали не проверял) | [ruslang.ru](https://ruslang.ru/doc/trudy/vol21/2-sichinava.pdf) |
| Tatoeba | **435** башкирских предложений (187-е место). Для сравнения: татарских — 101 736 | CC-BY 2.0 FR | — | [Tatoeba](https://tatoeba.org/en/stats/sentences_by_language) |
| Башкирская Википедия | **64 314** статей, 185 372 страницы, 87 активных участников | CC BY-SA 4.0 | — | [статистика](https://ba.wikipedia.org/wiki/Махсус:Статистика) |
| GiellaLT lang-bak | морфоанализатор, FST, около 35 тыс. лемм, статус «Beta», спеллер | **LGPL-3.0** | — | [GitHub](https://github.com/giellalt/lang-bak) |
| Apertium apertium-bak | лингвистические данные | GPL-3.0 | — | [GitHub](https://github.com/apertium/apertium-bak) |
| Открытый размеченный корпус РБ (тексты, аудио, диалекты) | в работе | **не подтверждено** | — | [СР-газета](https://srgazeta.ru/articles/aktualno/2026-09-10/bashkiriya-stanet-vserossiyskim-tsentrom-tsifrovogo-razvitiya-rodnyh-yazykov-4808689) |

Словари под открытыми лицензиями помимо Викисловаря (CC BY-SA) и GiellaLT/Apertium (LGPL/GPL) **не найдены (не подтверждено)**. Классические печатные башкирско-русские словари открытой лицензии не имеют. Это аргумент в пользу того, чтобы проект сам накапливал словарь с явной лицензией.

---

## E. Речь

### E1. Mozilla Common Voice (башкирский)

- **Scripted Speech 25.0** (срез на 09.03.2026): 218 518 клипов, **268,71 ч, из них 258,81 ч валидировано, 930 дикторов, CC0**. Пол указан у 328 дикторов, 84% не указали ([HF-датащит](https://huggingface.co/datasets/kamachkin/CVbashkir), [Mozilla Data Collective](https://datacollective.mozillafoundation.org/datasets/cmn29exhf014po107d6mpl5ec)). Условия MDC запрещают перевыкладывать датасет и устанавливать личность дикторов.
- Вышла версия **v26.0** (срез 12.06.2026) ([Discourse](https://discourse.mozilla.org/t/release-live-mcv-scripted-speech-v26-0-and-spontaneous-speech-v4-0/148687)). Цифры v26 по башкирскому **не подтверждены**. Начиная с v23 рост по башкирскому минимальный.
- Spontaneous Speech для башкирского почти пуст: 0,25 ч, 4 диктора в v3.0.

### E2. ASR

| Модель | База | Лицензия | WER | Источник |
|---|---|---|---|---|
| **AigizK/GigaAM-Bashkir-CV25** | GigaAM Multilingual 220M (Сбер, MIT) | **MIT** | **7,20% на val / 7,73% на test CV25** (нормализованный: lowercase, без пунктуации) | [HF](https://huggingface.co/AigizK/GigaAM-Bashkir-CV25) |
| AigizK/w2v-bert-2.0-bashkort-russian-omnivoice | w2v-bert-2.0 (MIT), 0,6B | CC-BY-4.0 | 15,23% на CV25 | [HF](https://huggingface.co/AigizK/w2v-bert-2.0-bashkort-russian-omnivoice) |
| AigizK/bashkir-whisper-small | whisper-small | Apache-2.0 | 15,07% на test CV11 | [HF](https://huggingface.co/AigizK/bashkir-whisper-small) |
| Whisper large-v3 (zero-shot) | — | Apache-2.0 | `ba` есть в списке языков токенизатора. WER **не подтверждено**, по опыту low-resource языков ожидается слабый результат | [tokenizer.py](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py), [HF](https://huggingface.co/openai/whisper-large-v3) |
| Meta MMS-1b-all | — | **CC-BY-NC-4.0** | `bak` поддерживается, WER **не подтверждено** | [HF](https://huggingface.co/facebook/mms-1b-all) |

- WER на Common Voice занижен относительно реальности: это чтение заданных фраз, и предложения повторяются. Для детских голосов и спонтанной речи ожидаемый WER заметно выше (**оценка**).
- Дополнительные данные: аудиокниги БРСБС — 43,6 ч псевдоразметки (ROVER + LLM, точность не измерена), CDLA-Permissive-2.0 ([HF](https://huggingface.co/datasets/AigizK/bashkir-brsbs-rover5-llm-high-confidence)).

### E3. TTS

| Решение | Голоса | Лицензия | Источник |
|---|---|---|---|
| **Silero `v5_cis_base` / `v5_cis_base_nostress`** | `bak_aigul`, `bak_alfia`, `bak_alfia2`, `bak_miyau`, `bak_ramilia`. 8 / 24 / 48 кГц | **MIT** (отдельный файл LICENSE_CIS). Вариант `nostress` требует расстановки ударений только для славянских языков | [GitHub](https://github.com/snakers4/silero-models) |
| Silero `v4_cyrillic` | `b_bashkir` (мужской) | CC BY-NC 4.0 | [GitHub](https://github.com/snakers4/silero-models) |
| Meta MMS-TTS `facebook/mms-tts-bak` | 1 голос (VITS) | **CC-BY-NC-4.0** | [HF](https://huggingface.co/facebook/mms-tts-bak) |
| Anadilorg/Anadil_Bashkir_TTS | LoRA на VoxCPM2, 48 кГц | MIT. **Обучен на одном дикторе Common Voice**, что этически и по условиям MDC сомнительно | [HF](https://huggingface.co/Anadilorg/Anadil_Bashkir_TTS) |
| AigizK/bashkort_tts_dataset (датасет) | 62 852 файла, 8 голосов. 1 диктор записан вживую (около 15 ч), остальные **клонированы через ElevenLabs** | CC-BY-4.0. Совместимость с условиями ElevenLabs **не подтверждена** | [HF](https://huggingface.co/datasets/AigizK/bashkort_tts_dataset) |

### E4. Коммерческие речевые API

- **SaluteSpeech (Сбер):** синтез на 12 языках (ru, uz, pt, pl, nl, kz, en, de, es, fr, it, ky), **башкирского нет** ([документация](https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/ssml/language)). В changelog за 2025–2026 годы башкирского для распознавания тоже нет ([changelog](https://developers.sber.ru/docs/ru/salutespeech/changelog)).
- **Yandex SpeechKit API:** в списке языков распознавания 17 кодов, **ни башкирского, ни татарского нет** ([документация](https://aistudio.yandex.ru/docs/ru/speechkit/stt/models)). В потребительском Переводчике речь на башкирском при этом есть ([СР-газета](https://srgazeta.ru/articles/aktualno/2026-09-10/bashkiriya-stanet-vserossiyskim-tsentrom-tsifrovogo-razvitiya-rodnyh-yazykov-4808689)). На странице «Языки народов России» сказано, что 6 языков поддерживают распознавание и синтез, и есть аудиопримеры на башкирском. Точный список **не подтверждён** ([Яндекс](https://yandex.ru/project/native-languages/)).

---

## F. Текст, типографика, ввод

### F1. Проверка орфографии

- **В LibreOffice и в коллекции hunspell от wooorm башкирского словаря нет** ([LibreOffice/dictionaries](https://github.com/LibreOffice/dictionaries), [wooorm/dictionaries](https://github.com/wooorm/dictionaries)) **[проверено по списку каталогов]**.
- **GiellaLT `speller-bak`** — FST-спеллер в статусе «Beta», около 35 тыс. лемм, LGPL-3.0. Ночные сборки для Windows, macOS и мобильных; движок `divvunspell` ([GitHub](https://github.com/giellalt/lang-bak)). Качество подсказок не измерено (бейдж 0,0%). Репозиторий `giellalt/keyboard-bak`, на который ссылается README, не найден (404).
- **Нейросетевые:**
  - `failed09/bashkir-diacritics-restorer` восстанавливает Ә Ғ Ҙ Ҡ Ң Ө Ҫ Ү Һ. Модель ConvBiGRU на 1,18М параметров в ONNX, работает на CPU, лицензия CC BY 4.0. Публичная версия: точное восстановление в 83,6% случаев, 97,6% чистого ввода не портит ([HF](https://huggingface.co/failed09/bashkir-diacritics-restorer)).
  - `slone/canine-c-bashkir-gec-v1` исправляет опечатки и ошибки OCR, сокращает число нужных правок на 40%, Apache-2.0 ([HF](https://huggingface.co/slone/canine-c-bashkir-gec-v1)).

### F2. Раскладки клавиатуры

- **iOS:** в разделе QuickType «Language Support» башкирского **нет**, хотя чувашский и казахский есть ([Apple](https://www.apple.com/ios/feature-availability/)). Встроенной раскладки нет, пользователям нужна сторонняя клавиатура.
- **Gboard:** башкирский в списке поддерживаемых языков есть ([Google](https://support.google.com/gboard/answer/6380730?hl=en)). Какие функции доступны (автокоррекция, свайп), **не подтверждено**.
- **Яндекс Клавиатура:** упомянута среди сервисов с языками народов России ([Яндекс](https://yandex.ru/project/native-languages/)). Поддержка именно башкирского **не подтверждена**.
- Вывод: **все поля ввода в приложении должны терпеть «неправильные» буквы и нормализовать их.** Плюс нужна своя экранная панель «ә ғ ҙ ҡ ң ө ҫ ү һ» над клавиатурой в iOS, Android и вебе.

### F3. Подмена букв и Unicode-нормализация

Канонические башкирские буквы относятся к блоку Cyrillic **[проверено через unicodedata]**:

| Буква | Код | Типичные подмены (что нормализовать) |
|---|---|---|
| Ә ә | U+04D8 / U+04D9 | латинская Ə ə (U+018F / U+0259), «ә»→«э», «а» |
| Ғ ғ | U+0492 / U+0493 | г, Ґ ґ (укр.), Ӻ |
| Ҙ ҙ | U+0498 / U+0499 | з, Ӡ (абх.) |
| Ҡ ҡ | U+04A0 / U+04A1 (BASHKIR KA) | к, **Қ қ (U+049A, казах.)**, Ҟ (U+049E), Ӄ (U+04C3) |
| Ң ң | U+04A2 / U+04A3 | н, Ҥ (U+04A4), Ӈ (U+04C7) |
| Ө ө | U+04E8 / U+04E9 | о, латинские Ɵ ɵ (U+019F / U+0275), ö |
| Ҫ ҫ | U+04AA / U+04AB | с, латинские Ç ç (U+00C7 / U+00E7), «с» + комбинируемая седиль U+0327 |
| Ү ү | U+04AE / U+04AF | у, латинская y, ü, Ұ (U+04B0, казах.) |
| Һ һ | U+04BA / U+04BB | **латинская h (U+0068)**, х |

Как обрабатывать:
1. NFC.
2. Детерминированная замена «чужих» символов (латиница, казахские и абхазские двойники) на канонические. Это безопасно, автозамену можно делать без вопросов.
3. Деградацию «ҡ→к» и подобную **автоматически не исправлять**. Вместо этого восстановитель диакритики предлагает подсказку «возможно, вы имели в виду…», и пользователь подтверждает.
4. В базе хранить исходный ввод и нормализованную форму. Сравнение вариантов перевода при голосовании вести по нормализованной форме.

### F4. Шрифты **[замер: fontTools по файлам из github.com/google/fonts и системным шрифтам macOS]**

Проверялся полный набор башкирских букв Ә ә Ғ ғ Ҙ ҙ Ҡ ҡ Ң ң Ө ө Ҫ ҫ Ү ү Һ һ.

| Шрифт (версия) | Покрытие | `locl` для башкирского (OpenType `BSH`) |
|---|---|---|
| PT Sans 2.003W | ✅ полное | ✅ BSH, CHU |
| Golos Text 2.004 | ✅ | — |
| Inter 4.001 | ✅ | — |
| Onest 2.001 | ✅ | — |
| Noto Sans 2.015 | ✅ | — |
| Montserrat 9.000 | ✅ | ✅ BSH, CHU |
| Roboto 3.015 | ✅ | — |
| Open Sans 3.003 | ✅ | — |
| IBM Plex Sans 3.201 | ✅ | — |
| Rubik 2.300 | ✅ | — |
| Nunito 3.602 | ✅ | ✅ BSH, CHU |
| SF Pro (системный шрифт macOS) | ✅ | ✅ BSH |
| **Manrope 4.505** | ❌ **нет Ә ә Ғ ғ Ҙ ҙ Ҡ ҡ Ң ң Ҫ ҫ** | — |
| **Unbounded 1.701** | ❌ **нет ни одной** башкирской буквы | — |
| PT Root UI | **не проверено**: файл вне Google Fonts | — |

- **Google Fonts CSS:** все башкирские буквы попадают в подмножество **`cyrillic-ext`** (U+0460–052F), а не в `cyrillic` (U+0400–045F, U+0490–0491, U+04B0–04B1) ([CSS API](https://fonts.googleapis.com/css2?family=Golos+Text)) **[проверено]**. При самостоятельном хостинге (fontsource и т.п.) обязательно подключать `cyrillic-ext`.
- Ставьте `lang="ba"` в HTML и задавайте локаль текста на iOS и Android. Тогда шрифты с `locl BSH` (PT Sans, Montserrat, Nunito, SF) покажут башкирские начертания Ҫ и Ҙ.
- Системный шрифт Android (Roboto) и шрифт iOS (SF, проверен на macOS) башкирский покрывают. Отдельно на iOS это **не проверено**, но семейство то же.

### F5. ICU/CLDR и сортировка

- В CLDR есть локаль `ba`: `common/main/ba.xml`, уровень покрытия **basic**, exemplar-набор из 42 букв ([ba.xml](https://github.com/unicode-org/cldr/blob/main/common/main/ba.xml)). Файла `common/collation/ba.xml` **нет** **[проверено: 404]**.
- **[замер]** В Node 25.9 (ICU 78.3, CLDR 48) `new Intl.Collator("ba")` разрешается в `en-US`, то есть в корневую сортировку. Получается порядок «А **Ә** Б … Э Ю Я», а по башкирскому алфавиту **Ә стоит после Э**: «… Ь Э Ә Ю Я». Утверждённый порядок: А Б В Г Ғ Д Ҙ Е Ё Ж З И Й К Ҡ Л М Н Ң О Ө П Р С Ҫ Т У Ү Ф Х Һ Ц Ч Ш Щ Ъ Ы Ь Э Ә Ю Я ([Википедия](https://ru.wikipedia.org/wiki/Башкирская_письменность)). Остальные буквы корневая сортировка ставит правильно.
- Исправление — tailoring-правило ICU `&Э < ә <<< Ә`. В PostgreSQL 16+ это `CREATE COLLATION ba_tailored (provider = icu, locale = 'ru', rules = '&Э < ә <<< Ә')` ([PG docs](https://www.postgresql.org/docs/16/sql-createcollation.html)). На Android — `android.icu.text.RuleBasedCollator`. На iOS и в вебе — свой ключ сортировки или серверная сортировка (Intl.Collator правила не принимает).

---

## G. Алгоритмы

### G1. FSRS (интервальные повторения)

- Статья: Ye, Su, Cao, «A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling», KDD 2022 ([ACM DOI](https://dl.acm.org/doi/10.1145/3534678.3539081)). Бенчмарк планировщиков — [srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark).
- Реализации из организации [open-spaced-repetition](https://github.com/open-spaced-repetition):

| Платформа | Пакет | Версия FSRS | Лицензия |
|---|---|---|---|
| TS (веб, бот, бэкенд) | `ts-fsrs` 6.0.0 (28.10.2026). Оптимизатор отдельно: `@open-spaced-repetition/binding` | FSRS-3…7, **по умолчанию FSRS-7** | MIT ([GitHub](https://github.com/open-spaced-repetition/ts-fsrs), [npm](https://www.npmjs.com/package/ts-fsrs)) |
| Swift (iOS) | `swift-fsrs` (SPM) | FSRS-6 | MIT ([GitHub](https://github.com/open-spaced-repetition/swift-fsrs)) |
| JVM / Android | `java-fsrs`, Maven `io.github.open-spaced-repetition:fsrs`, Java 17 | 21 параметр (≈FSRS-6) | MIT ([GitHub](https://github.com/open-spaced-repetition/java-fsrs)) |
| Kotlin | `FSRS-Kotlin` | FSRS-6 | MIT указана только в README, файла LICENSE нет ([GitHub](https://github.com/open-spaced-repetition/FSRS-Kotlin)) |
| Python | `fsrs` 6.3.2 (09.08.2026) | — | MIT ([PyPI](https://pypi.org/project/fsrs/)) |
| Rust (оптимизатор) | `fsrs-rs` | — | BSD-3 |

- **Важно:** версии на разных платформах расходятся (ts-fsrs по умолчанию FSRS-7, Swift и Kotlin — FSRS-6). Решение: считать расписание на **сервере** одной реализацией (ts-fsrs или py-fsrs) с зафиксированной версией алгоритма и параметров. Клиентские реализации — только для офлайна, с той же версией FSRS-6 и синхронизацией review-логов.

### G2. Агрегация краудсорсинговых меток

- **Dawid–Skene** (1979): EM-оценка матрицы ошибок каждого разметчика ([DOI](https://doi.org/10.2307/2346806)).
- **GLAD** (Whitehill et al., NIPS 2009): учитывает компетентность разметчика и сложность задания ([NeurIPS](https://proceedings.neurips.cc/paper/2009/hash/f899139df5e1059396431415e770c6dd-Abstract.html)).
- **Готовая реализация — Toloka `crowd-kit` (Apache-2.0):** MV, DS, One-coin DS, GLAD, MACE, Wawa, ZBS, KOS, M-MSR. Попарные методы: **Bradley–Terry, NoisyBT**. Тексты: ROVER, RASA, HRRASA ([GitHub](https://github.com/Toloka/crowd-kit)). Подходит для офлайн-пересчёта (Python-воркер).

### G3. Попарные сравнения вариантов перевода

- **Bradley–Terry** (1952) ([DOI](https://doi.org/10.2307/2334029)) и NoisyBT (учитывает шумных голосующих) — в crowd-kit.
- **TrueSkill** (Herbrich, Minka, Graepel, NIPS 2006) ([MSR](https://www.microsoft.com/en-us/research/publication/trueskill-a-bayesian-skill-rating-system/)). Патентные ограничения Microsoft **не подтверждены** в этом ресерче. Безопаснее брать **OpenSkill** (модели Weng–Lin, [JMLR 2011](https://www.jmlr.org/papers/v12/weng11a.html)): MIT, есть Python, JS, Java, Kotlin, но нет Swift ([openskill.py](https://github.com/OpenDebates/openskill.py)). Это онлайн-рейтинг вариантов и, при желании, игроков и школ.

### G4. Метрики MT

- **chrF++** (Popović, WMT 2017) ([ACL](https://aclanthology.org/W17-4770/)). Считается через sacreBLEU с флагом `-m chrf --chrf-word-order 2` (Apache-2.0) ([GitHub](https://github.com/mjpost/sacrebleu)). Это основная метрика LoResMT для башкирского.
- **COMET** (Rei et al., 2020) ([ACL](https://aclanthology.org/2020.emnlp-main.213/)). Модели построены на XLM-R, в котором **нет башкирского**, а README прямо предупреждает: «results for language pairs containing uncovered languages are unreliable» ([COMET](https://github.com/Unbabel/COMET), [XLM-R card](https://huggingface.co/FacebookAI/xlm-roberta-large) — `ba` нет в тегах языков). **COMET для башкирского нет.** Замена: chrF++, экспертная оценка учителей и LaBSE-bak similarity как грубый QE-фильтр. Порог 0,80 по семантической близости DevLake использовали для чистки корпуса ([HF](https://huggingface.co/Voldis/nllb-1.3b-rus-bak)).

---

## Рекомендации для архитектуры

### R1. Как использовать GigaChat

1. **LLM Gateway на бэкенде** — единственная точка вызова LLM. Он кеширует access token около 25 минут (живёт 30), держит в доверенных сертификаты НУЦ, ограничивает параллельность в пределах лимита потоков, умеет повторять запрос и откатываться на другую модель, журналирует промпты и ответы (это понадобится и для требований ФСТЭК № 117). Клиенты iOS, Android, веб и бот ходят только в наш API.
2. **Абстракция провайдера.** OpenAI-совместимый интерфейс с тремя бэкендами: (а) Sber `api.giga.chat` по договору юрлица; (б) Cloud.ru Evolution Foundation Models; (в) свой GigaChat 3.1 Lightning на vLLM (MIT) как резерв и для дешёвых задач.
3. **Маршрутизация по задачам:**
   - Предпроверка ответа ученика и классификация: Lightning или Lite, `json_schema strict`, температура 0.
   - Объяснение ошибки, подсказка, генерация примеров: Max, 3 Ultra или 3.5 Ultra.
   - Офлайн-генерация контента: batch/async (в 2 раза дешевле), затем обязательная модерация человеком.
4. **Structured output везде.** Ответ — JSON со схемой вида `{verdict, confidence, issues[], suggested_fix?}`, никакого свободного текста. Это делает поведение модели проверяемым.
5. **Eval-набор до запуска:** 300–500 пар рус↔баш от учителей и методистов, по нескольку эталонов на пару. Им выбирается модель и промпт и ловятся регрессии при смене версий: Сбер сам меняет модели за алиасами `GigaChat`, `GigaChat-2`.

### R2. Чему LLM НЕ доверять

- **Не считать перевод LLM подтверждённым.** В базу «подтверждённых переводов», которая отдаётся по API, попадают только варианты, прошедшие человеческий консенсус (DS/GLAD + BT), с полем происхождения: `human` / `mt` / `llm` / `seed`.
- **Не давать LLM решать голосования.** LLM-оценка — максимум ещё один «разметчик» с выученной надёжностью и ограниченным весом. Голос он не заменяет.
- **Орфографию и нормы не отдавать LLM.** Для них есть детерминированный нормализатор (F3), GiellaLT-спеллер и восстановитель диакритики. Подмену ҡ→к LLM исправляет непоследовательно (**оценка**), а независимых измерений нет.
- **Лексикографические «факты» LLM не генерирует:** этимологию, диалектную принадлежность, редкие значения. Риск галлюцинаций высокий, бенчмарков на башкирском нет.
- **ASR, TTS и MT — подсказки, а не эталон.** В интерфейсе это нужно маркировать.
- **Персональные данные детей в промпт не передаются.** Только псевдонимизированные идентификаторы, без ФИО и школы.

### R3. Открытые модели и датасеты: что можно брать с учётом лицензий

| Можно в прод (коммерческое и государственное использование, с атрибуцией) | Только для исследований и внутренней оценки (NC) | Не использовать / нужна проверка |
|---|---|---|
| GigaChat 3.1 Lightning / 3.5 Ultra (MIT) | NLLB-200 и все производные (CC-BY-NC), включая `Voldis/nllb-1.3b-rus-bak` и модели Karpov | `zhursvlevy/t5-small` (лицензия не указана) |
| M2M-100 418M + `Voldis/m2m100-rus-bak` (MIT), `Voldis/marian-rus-bak` (Apache-2.0) | MMS-1b-all, MMS-TTS-bak (CC-BY-NC) | синтетическая часть `BorisTM/bak-rus-parallel` (сделана моделью под NC) |
| MADLAD-400 MT (Apache-2.0); качество проверить | Silero `v4_cyrillic` (CC BY-NC) | Anadil Bashkir TTS (голос из CV), `bashkort_tts_dataset` (клоны ElevenLabs) |
| Корпус AigizK (CC-BY-4.0), Common Voice (CC0, без перевыкладки), Википедия (CC BY-SA) | — | `bashqort-raw` (MIT поверх чужих новостей) |
| GigaAM-Bashkir-CV25 (MIT), whisper-small-ba (Apache-2.0) | — | — |
| **Silero `v5_cis_base` (MIT, 5 башкирских голосов)** | — | — |
| GiellaLT lang-bak (LGPL: только как отдельный сервис или библиотека), diacritics-restorer (CC BY 4.0), canine GEC (Apache-2.0), LaBSE-bak (Apache-2.0) | — | — |
| crowd-kit (Apache-2.0), OpenSkill (MIT), FSRS (MIT), sacreBLEU (Apache-2.0) | — | — |

Совместимость лицензий для итоговой базы проекта (CC-BY / CC-BY-SA / CC0 входы и что из этого следует для API) должен подтвердить юрист.

### R4. Оценка стоимости токенов на 1 активного пользователя в месяц

**Допущения (явно):**
- Активный пользователь занимается 20 дней в месяц по 10 заданий в день, итого 200 заданий.
- **Предпроверка каждого ответа (200 вызовов):** вход 500 токенов (системный промпт и рубрика около 300, примеры около 130, сама пара около 70 с учётом 1,78× на башкирский текст), выход 80 токенов (JSON).
- **Подсказки и объяснения** для 25% заданий (50 вызовов): вход 400, выход 250.
- **Еженедельный дайджест или мотивационное сообщение** (4 вызова): вход 1 200, выход 300.
- Итого **около 155 тыс. токенов в месяц**: 124,8 тыс. входных и 29,7 тыс. выходных.
- «Тяжёлый» сценарий добавляет AI-репетитора: 20 сессий × 6 реплик, средний вход 1 500 (растущий контекст), выход 200. Итого около 359 тыс. токенов.
- Цены Сбера с НДС ([тарифы](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)). Цены Cloud.ru: 3.5 Ultra — по ComNews, Lightning и Pro — **[данные другого агента]**, НДС не уточнён. Кеширование промптов не учитывалось (это консервативная оценка).

| Сценарий / модель | ₽ на активного пользователя в месяц |
|---|---|
| **Лёгкий** (только 10 подсказок, около 6,5 тыс. токенов): Max / Lite | 4,2 / 0,4 |
| **Базовый, 155 тыс. токенов:** | |
| GigaChat 3 Lightning (Cloud.ru, 12,2 ₽/1М) | **≈1,9** |
| GigaChat 2 Lite, синхронно (Сбер) / асинхронно | **≈10,0** / 5,0 |
| GigaChat 3 Pro (Cloud.ru, 73/176) | ≈14,3 |
| GigaChat 3.5 Ultra (Cloud.ru, 96/289) | ≈20,6 |
| GigaChat 2 Pro / Max (Сбер, синхронно) | ≈77 / **≈100** |
| **Смешанная схема:** Lightning на проверку и дайджест + 3.5 Ultra на подсказки | **≈7,0** |
| Смешанная схема: Lite + Max (только Сбер) | ≈29 |
| **Тяжёлый, 359 тыс. токенов:** Lightning / Lite / 3.5 Ultra / Max | ≈4,4 / ≈23 / ≈45 / ≈233 |

**Масштаб в месяц** (базовый сценарий): 10 000 активных пользователей — около 1,55 млрд токенов. Стоимость: около 19 тыс. ₽ на Lightning, около 70 тыс. ₽ в смешанной схеме, около 100 тыс. ₽ на Lite, около 1 млн ₽ на Max.

Разовая офлайн-генерация контента — 20 тыс. заготовок по ~1 000 токенов на Max в асинхронном режиме — обойдётся примерно в 6,5 тыс. ₽ за 20М токенов.

Freemium физлица (250М токенов Lite) покрывает около 1 600 «пользователе-месяцев», но в 1 поток. Это песочница для разработки, а не прод.

**Пропускная способность.** 10 потоков по умолчанию и около 2 с на вызов дают порядка 5 запросов в секунду, примерно 18 тыс. вызовов в час. Если 10 тыс. пользователей в день делают по 10 вызовов (100 тыс. в день) и пики приходятся на уроки, лимит придётся поднимать по письму в Сбер. Неинтерактивные вызовы стоит переводить в batch.

### R5. Прочие архитектурные выводы

- **MT-подсказка «черновой перевод»** — свой сервис на M2M-100 (`Voldis/m2m100-rus-bak`, MIT) или Marian (CPU). Направление баш→рус — через GigaChat или Яндекс Переводчик API (коммерческие условия проверить). Черновик никогда не показывается как правильный ответ: только после того, как пользователь отправил свой вариант, или как «вариант машины» для голосования. Так видна разница с человеческим переводом.
- **Речь.** ASR для заданий «произнеси» — GigaAM-Bashkir-CV25 (MIT) на своём GPU или CPU. TTS для озвучки слов — Silero `v5_cis_base_nostress` (MIT) с пред-генерацией и кешированием аудио в CDN. Детские голоса в Common Voice почти не представлены, поэтому нужен свой сбор с согласия законных представителей (юридическую сторону решает другой агент).
- **Текст.** Нормализатор (F3) общий для бэкенда и клиентов (одна таблица замен в JSON). Шрифты — Golos, Onest, Inter, PT Sans или Montserrat, **не Manrope и не Unbounded**. Подключать `cyrillic-ext` и `lang="ba"`. Сортировка — по ICU-правилу `&Э < ә <<< Ә`.
- **Качество и консенсус.** crowd-kit для пересчёта DS/GLAD и BT (Python-воркер), OpenSkill для онлайн-рейтингов, chrF++ для регрессий MT. FSRS — на сервере, версия зафиксирована.
- **Своё будущее преимущество** — накопленный корпус подтверждённых пар с понятной лицензией (CC-BY-4.0 или CC0). Через 6–12 месяцев на нём можно дообучить M2M-100 или Lightning и опубликовать бенчмарк, которого сейчас нет (башкирский eval для GigaChat, YandexGPT и других).

---

## Источники

**GigaChat / Сбер**
- Модели: https://developers.sber.ru/docs/ru/gigachat/models
- GigaChat 3 Ultra: https://developers.sber.ru/docs/ru/gigachat/models/gigachat-3-ultra
- GigaChat 2 Max: https://developers.sber.ru/docs/ru/gigachat/models/gigachat-2-max
- GigaChat 2 Lite: https://developers.sber.ru/docs/ru/gigachat/models/gigachat-2-lite
- Changelog: https://developers.sber.ru/docs/ru/gigachat/changelog
- Тарифы физлиц: https://developers.sber.ru/docs/ru/gigachat/tariffs/individual-tariffs
- Тарифы юрлиц: https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs
- Лимиты: https://developers.sber.ru/docs/ru/gigachat/limitations
- Авторизация: https://developers.sber.ru/docs/ru/gigachat/api/authorization
- Сертификаты: https://developers.sber.ru/docs/ru/gigachat/certificates
- SDK: https://developers.sber.ru/docs/ru/gigachat/guides/using-sdks
- Structured output: https://developers.sber.ru/docs/ru/gigachat/guides/structured-output
- Изображения: https://developers.sber.ru/docs/ru/gigachat/guides/images-generation
- Портал GigaChat API: https://developers.sber.ru/portal/products/gigachat-api
- Python SDK: https://github.com/ai-forever/gigachat · https://pypi.org/project/gigachat/ · https://pypi.org/project/langchain-gigachat/ · https://www.npmjs.com/package/gigachat
- Cloud.ru, GigaChat 3.5 Ultra: https://www.comnews.ru/content/246519/2026-07-22/2026-w30/1018/biznesu-stala-dostupna-odna-samykh-moschnykh-russkoyazychnykh-modeley-gigachat-35-ultra
- Cloud.ru, GigaChat 3.5 Reasoning: https://www.comnews.ru/content/247512/2026-09-23/2026-w39/1018/cloudru-otkryl-biznesu-dostup-k-novoy-modeli-gigachat-35-reasoning
- Динамика цен: https://adindex.ru/news/digital/2026/08/25/348304.phtml
- Открытые веса: https://huggingface.co/ai-sage/GigaChat3.1-702B-A36B · https://huggingface.co/ai-sage/GigaChat3.1-10B-A1.8B · https://huggingface.co/ai-sage/GigaChat3.5-432B-A28B
- Обзоры открытых весов: https://habr.com/ru/articles/985976/ · https://digital-razor.ru/media/news/software/sber-gigachat-3-1-ultra-lightning/ · https://vc.ru/ai/3027960-gigachat-3-5-ultra-ot-sbera
- Данные и приватность: https://www.securitylab.ru/analytics/561047.php · https://vc.ru/ai/3053139-gigachat-i-analiz-dokumentov · https://habr.com/ru/articles/924352
- Программа для некоммерческих проектов (2023): https://sber.pro/publication/sber-otkryl-dostup-k-gigachat-api-dlya-nekommercheskogo-ispolzovaniya/
- Данные другого агента: тарифы Cloud.ru (Lightning, 3 Pro, GigaEmbedding), sberbusiness.live (10.04.2026), приказ ФСТЭК № 117. Мной не перепроверены.

**Башкирский в LLM, регион**
- https://www.ixbt.com/news/2026/04/10/sber-obnovil-iipomoshnika-gigachat-dostupno-bolee-30-jazykov-narodov-rossii-i-stran-sng.html
- https://www.vedomosti.ru/technology/news/2026/04/10/1189462-gigachat-nachal-podderzhivat
- https://finance.mail.ru/article/na-90-yazykah-sber-otvechal-polzovatelyam-v-chate-podderzhki-v-tom-chisle-na-tatarskom-i-elfijskom-69231143/
- https://arxiv.org/html/2610.31397 (Arabov & Khaybullina, 2026)
- https://arxiv.org/abs/2502.11020 (TUMLU)
- https://srgazeta.ru/articles/aktualno/2026-09-10/bashkiriya-stanet-vserossiyskim-tsentrom-tsifrovogo-razvitiya-rodnyh-yazykov-4808689
- https://bash.news/news/266397-neiroseti-naucilis-raspoznavat-baskirskii-iazyk
- https://resbash.ru/news/tekhnologii/2026-05-23/oleg-li-obuchat-ii-bashkirskomu-yazyku-vklad-v-buduschee-yazyka-v-tsifrovoy-srede-4697303
- https://abnews.ru/volga/news/bashkortostan/2026/8/8/v-bashkirii-nachali-sozdavat-dannye-dlya-obucheniya-ii-bashkirskomu-yazyku

**Машинный перевод**
- LoResMT 2026: https://arxiv.org/abs/2602.04442 · https://aclanthology.org/2026.loresmt-1.17/ · https://aclanthology.org/2026.loresmt-1.18/ · https://aclanthology.org/2026.loresmt-1.20
- Модели DevLake: https://huggingface.co/Voldis/nllb-1.3b-rus-bak · https://huggingface.co/Voldis/m2m100-rus-bak · https://huggingface.co/Voldis/marian-rus-bak
- NLLB: https://huggingface.co/facebook/nllb-200-distilled-600M · https://huggingface.co/facebook/nllb-200-1.3B
- M2M-100: https://huggingface.co/facebook/m2m100_418M
- MADLAD-400: https://huggingface.co/google/madlad400-3b-mt · https://huggingface.co/datasets/allenai/MADLAD-400
- OPUS-MT: https://huggingface.co/Helsinki-NLP/opus-mt-en-trk · https://huggingface.co/Helsinki-NLP/opus-mt-trk-en
- Яндекс: https://aistudio.yandex.ru/docs/ru/translate/concepts/supported-languages · https://yandex.ru/project/native-languages/
- Google: https://blog.google/products/translate/google-translate-new-languages-2024/ · https://support.google.com/translate/answer/15139004
- Прочие модели: https://huggingface.co/slone/LaBSE-shallow-distilled-bak · https://huggingface.co/zhursvlevy/t5-small-bashkir-russian · https://huggingface.co/AigizK

**Корпуса**
- https://huggingface.co/datasets/AigizK/bashkir-russian-parallel-corpora
- https://huggingface.co/datasets/BorisTM/bak-rus-parallel
- https://huggingface.co/datasets/BashkirNLPWorld/bashkir-web-corpus
- https://huggingface.co/datasets/metuKKhud/bashqort-raw
- https://github.com/nevmenandr/bashkir-corpus
- https://tatoeba.org/en/stats/sentences_by_language
- https://ba.wikipedia.org/wiki/Махсус:Статистика
- https://github.com/giellalt/lang-bak · https://github.com/apertium/apertium-bak
- https://ruslang.ru/doc/trudy/vol21/2-sichinava.pdf

**Речь**
- Common Voice: https://huggingface.co/datasets/kamachkin/CVbashkir · https://datacollective.mozillafoundation.org/datasets/cmn29exhf014po107d6mpl5ec · https://discourse.mozilla.org/t/release-live-mcv-scripted-speech-v26-0-and-spontaneous-speech-v4-0/148687
- ASR: https://huggingface.co/AigizK/GigaAM-Bashkir-CV25 · https://huggingface.co/AigizK/w2v-bert-2.0-bashkort-russian-omnivoice · https://huggingface.co/AigizK/bashkir-whisper-small · https://huggingface.co/facebook/mms-1b-all · https://github.com/openai/whisper/blob/main/whisper/tokenizer.py · https://huggingface.co/openai/whisper-large-v3
- Аудиоданные: https://huggingface.co/datasets/AigizK/bashkir-brsbs-rover5-llm-high-confidence · https://huggingface.co/datasets/AigizK/bashkort_tts_dataset
- TTS: https://github.com/snakers4/silero-models · https://huggingface.co/facebook/mms-tts-bak · https://huggingface.co/Anadilorg/Anadil_Bashkir_TTS
- SaluteSpeech: https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/ssml/language · https://developers.sber.ru/docs/ru/salutespeech/changelog
- Yandex SpeechKit: https://aistudio.yandex.ru/docs/ru/speechkit/stt/models

**Текст, ввод, шрифты, локаль**
- Словари: https://github.com/LibreOffice/dictionaries · https://github.com/wooorm/dictionaries
- Восстановление и исправление текста: https://huggingface.co/failed09/bashkir-diacritics-restorer · https://huggingface.co/slone/canine-c-bashkir-gec-v1
- Клавиатуры: https://www.apple.com/ios/feature-availability/ · https://support.google.com/gboard/answer/6380730?hl=en
- Шрифты: https://github.com/google/fonts · https://fonts.googleapis.com/css2?family=Golos+Text
- CLDR: https://github.com/unicode-org/cldr/blob/main/common/main/ba.xml
- Алфавит: https://ru.wikipedia.org/wiki/Башкирская_письменность
- PostgreSQL: https://www.postgresql.org/docs/16/sql-createcollation.html

**Алгоритмы и метрики**
- FSRS: https://github.com/open-spaced-repetition · https://github.com/open-spaced-repetition/ts-fsrs · https://github.com/open-spaced-repetition/swift-fsrs · https://github.com/open-spaced-repetition/java-fsrs · https://github.com/open-spaced-repetition/FSRS-Kotlin · https://github.com/open-spaced-repetition/srs-benchmark · https://www.npmjs.com/package/ts-fsrs · https://pypi.org/project/fsrs/ · https://dl.acm.org/doi/10.1145/3534678.3539081
- Агрегация меток: https://doi.org/10.2307/2346806 (Dawid–Skene) · https://proceedings.neurips.cc/paper/2009/hash/f899139df5e1059396431415e770c6dd-Abstract.html (GLAD) · https://github.com/Toloka/crowd-kit
- Рейтинги: https://doi.org/10.2307/2334029 (Bradley–Terry) · https://www.microsoft.com/en-us/research/publication/trueskill-a-bayesian-skill-rating-system/ · https://www.jmlr.org/papers/v12/weng11a.html · https://github.com/OpenDebates/openskill.py
- Метрики MT: https://aclanthology.org/W17-4770/ (chrF++) · https://github.com/mjpost/sacrebleu · https://aclanthology.org/2020.emnlp-main.213/ (COMET) · https://github.com/Unbabel/COMET · https://huggingface.co/FacebookAI/xlm-roberta-large
