// Слайды презентации (3 минуты). Раскладки: «side» — текст слева, экраны справа на подложке; «top» — заголовок
// сверху, под ним экраны с подписями; отдельные слайды «цикл» и «данные и API». Текст — обычные предложения о том,
// что видно на экране. QR — SVG из build.mjs. Картинки — design/assets/approved, снимки — shots/.

const ART = "../design/assets/approved";

/** Запись публичной выгрузки словаря (GET /api/v1/public/dictionary на стенде), без изменений. */
const RECORD = {
  fragmentId: "01a1da3f-6d57-7e24-a046-ace62a91b256",
  textBa: "Был күпме тора?",
  langPair: "ba-ru",
  translation: "Сколько это стоит?",
  sources: [
    {
      title: "Викигид: Башкирский разговорник",
      locator: "раздел «Покупки», строка «Сколько это стоит?»",
      license: "CC BY-SA 4.0",
    },
  ],
  confirmed: 5,
  status: "confirmed",
};

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function deck({ qr, operations }) {
  /** Телефон: ширина экрана w (рамка снаружи), pos — координаты для свободной раскладки на подложке. */
  const phone = (src, w = 320, pos = "") => `<div class="phone${pos ? " at" : ""}" style="--w:${w}px;${pos}"><img src="shots/${src}" alt=""></div>`;

  /** Окно браузера фиксированного размера: снимок по ширине окна, низ обрезается. */
  const win = (src, w, h, pos = "", url = "") =>
    `<div class="win${pos ? " at" : ""}" style="width:${w}px;height:${h}px;${pos}"><div class="win__bar"><i></i><i></i><i></i>${url ? `<span>${url}</span>` : ""}</div><img src="shots/${src}" alt=""></div>`;

  /** Экран с подписью под ним. */
  const shot = (device, caption) => `<figure class="shot">${device}<figcaption>${caption}</figcaption></figure>`;

  const brand = () => `<div class="brand"><img src="${ART}/app-icon.webp" alt="">ТелеТау</div>`;
  const foot = (n, total) => `<div class="foot">${brand()}<span>${String(n).padStart(2, "0")} / ${total}</span></div>`;

  /** Текст слева, экраны справа. */
  const side = (title, paragraphs, stage) => (n, total) => `
<section class="slide side">
  <div class="side__text">
    <h2 class="title">${title}</h2>
    ${paragraphs.map((p) => `<p class="body">${p}</p>`).join("")}
  </div>
  <div class="stage">${stage}</div>
  ${foot(n, total)}
</section>`;

  /** Заголовок сверху, экраны с подписями. */
  const top = (title, note, row) => (n, total) => `
<section class="slide top">
  <h2 class="title">${title}</h2>
  ${note ? `<p class="note">${note}</p>` : ""}
  <div class="row">${row}</div>
  ${foot(n, total)}
</section>`;

  const step = (name, text) => `<li><b>${name}</b><p>${text}</p></li>`;
  const endpoint = (path, text) => `<li><code>${path}</code><p>${text}</p></li>`;

  const slides = [
    // Обложка
    () => `
<section class="slide cover">
  <div class="cover__text">
    ${brand()}
    <p class="cover__sub">Платформа для изучения башкирского языка и&nbsp;сбора парных переводов</p>
    <p class="cover__lead">Сайт, Telegram-бот, приложения для iOS и&nbsp;Android.</p>
    <p class="cover__url">teletau.study</p>
  </div>
  <div class="cover__art">
    <img src="${ART}/hero-landing.webp" alt="">
    <div class="bubble" style="top:20%;left:16%">Сәләм!</div>
  </div>
</section>`,

    // Полный цикл на одной реальной паре из словаря
    (n, total) => `
<section class="slide flow">
  <h2 class="title">Полный цикл</h2>
  <p class="note">Как фраза из разговорника попадает в&nbsp;словарь. Пример настоящий, из&nbsp;выгрузки на&nbsp;teletau.study.</p>
  <ol class="steps">
    ${step("Источник", "Викигид: Башкирский разговорник. Ещё Викисловарь, Tatoeba и&nbsp;Викиданные, у&nbsp;каждой строки своя лицензия.")}
    ${step("Фрагмент", "«Был күпме тора?» с&nbsp;координатами: раздел «Покупки», строка «Сколько это стоит?».")}
    ${step("Задание", "Пара появляется в&nbsp;уроке или в&nbsp;«Задании дня» в&nbsp;Telegram. Ученик выбирает лучший перевод.")}
    ${step("Согласование", "Голоса детей, взрослых и&nbsp;учителей считаются отдельно. Кнопка «Оба подходят» учитывает синонимы, спорные пары уходят экспертам.")}
    ${step("Словарь", "Пара получает статус confirmed и&nbsp;попадает в&nbsp;выгрузку CSV и&nbsp;JSON.")}
  </ol>
  <p class="flow__pairs">Языковые пары: башкирский и&nbsp;русский, башкирский и&nbsp;казахский.</p>
  ${foot(n, total)}
</section>`,

    side(
      "«Помоги языку»",
      [
        "Задание встроено в&nbsp;урок: ученик видит два перевода и&nbsp;выбирает тот, что звучит естественнее. Можно ответить «Оба подходят» или «Не знаю».",
        "Принятые пары видны в&nbsp;открытом словаре на&nbsp;сайте. Сейчас в&nbsp;нём 86&nbsp;пар.",
      ],
      `<div class="stage__row">${phone("duel.png", 330)}${win("dictionary.png", 520, 760, "", "teletau.study/dictionary")}</div>`,
    ),

    side(
      "Путь ученика",
      [
        "Кроме заданий есть полный курс: шесть мест Башкортостана от&nbsp;Уфы до&nbsp;Сабантуя, 35&nbsp;уроков по&nbsp;пять минут.",
        "Школьник входит по&nbsp;QR-карточке класса. Имя и&nbsp;телефон ребёнка не&nbsp;нужны.",
      ],
      `${win("web-home.png", 880, 620, "top:72px;left:56px", "teletau.study/learn")}
       ${phone("trail.png", 300, "right:64px;bottom:56px")}`,
    ),

    top(
      "Урок",
      "Каждое слово курса озвучено: записи носителей и&nbsp;синтез речи. Забытые слова возвращаются на&nbsp;повторение.",
      `${shot(phone("lesson-tiles.png", 250), "Фраза из готовых слов")}
       ${shot(phone("lesson-word.png", 250), "Новое слово с&nbsp;озвучкой")}
       ${shot(phone("result.png", 250), "Итог урока")}`,
    ),

    side(
      "Разбор ошибок",
      [
        "На&nbsp;клавиатуре есть девять башкирских букв. Если ошибка в&nbsp;одной букве, ответ засчитывается как «почти», и&nbsp;буква подсвечивается.",
        "Кнопка «Почему так?» объясняет ошибку. Взрослым текст пишет GigaChat, детям показываем подсказку методиста.",
      ],
      `<div class="stage__row">${phone("lesson-almost.png", 360)}${phone("explain.png", 360)}</div>`,
    ),

    top(
      "Рейтинги",
      "Мёд за уроки и&nbsp;голоса, серия дней, лиги и&nbsp;12&nbsp;наград. Школы и&nbsp;классы соревнуются на&nbsp;доске почёта за&nbsp;день, неделю, месяц и&nbsp;год.",
      `${shot(phone("league.png", 250), "Лига недели")}
       ${shot(phone("android-board.png", 250), "Доска почёта")}
       ${shot(phone("awards.png", 250), "Награды")}`,
    ),

    top(
      "Кабинет учителя",
      "Учитель создаёт класс, печатает QR-карточки одним PDF и&nbsp;даёт задания на&nbsp;неделю.",
      `${shot(win("teacher-home.png", 820, 540, "", "teletau.study/teacher"), "Кто занимался сегодня и&nbsp;кто отстаёт")}
       ${shot(win("teacher-progress.png", 820, 540), "Прогресс по&nbsp;урокам, отчёт в&nbsp;CSV")}`,
    ),

    side(
      "Министерство и&nbsp;Фонд",
      [
        "Министерство видит активность по&nbsp;районам и&nbsp;школам. Группы меньше пяти учеников скрыты.",
        "Фонд получает принятые пары с&nbsp;голосами и&nbsp;источниками, а&nbsp;спорные случаи отдельным списком для экспертов.",
      ],
      `${win("ministry.png", 820, 560, "top:48px;left:48px", "console.teletau.study/republic")}
       ${win("fund.png", 800, 520, "right:48px;bottom:48px", "console.teletau.study/fund")}`,
    ),

    // Данные и API
    (n, total) => `
<section class="slide api">
  <h2 class="title">Данные и API</h2>
  <div class="api__grid">
    <pre class="code">${escapeHtml(JSON.stringify(RECORD, null, 2))}</pre>
    <div>
      <ul class="endpoints">
        ${endpoint("GET /api/v1/public/dictionary", "Выгрузка словаря по&nbsp;схеме из&nbsp;ТЗ, JSON или CSV, без ключа")}
        ${endpoint("GET /api/v1/public/leaderboard", "Доска почёта за&nbsp;день, неделю, месяц и&nbsp;год")}
        ${endpoint("teletau.study/api-docs", `Описание всех ${operations} операций и&nbsp;файл openapi.yaml`)}
      </ul>
      <p class="body api__stack">PostgreSQL&nbsp;17 и&nbsp;NestJS. Инструкция по&nbsp;развёртыванию лежит в&nbsp;репозитории.</p>
    </div>
  </div>
  ${foot(n, total)}
</section>`,

    top(
      "Сайт, приложения и&nbsp;Telegram",
      "Интерфейс на&nbsp;русском, башкирском и&nbsp;казахском. Бот @TeleTauBot присылает задание дня и&nbsp;напоминания, открывает Mini App.",
      `${shot(win("landing-ba.png", 760, 463), "Сайт на&nbsp;башкирском")}
       ${shot(phone("ios-trail.png", 214), "iOS")}
       ${shot(phone("android-welcome.png", 214), "Android")}
       ${shot(phone("miniapp.png", 214), "Telegram")}`,
    ),

    // Финал
    () => `
<section class="slide final">
  <div>
    ${brand()}
    <p class="final__link">teletau.study</p>
    <p class="final__link">@TeleTauBot в&nbsp;Telegram</p>
  </div>
  <div class="final__qr">${qr}</div>
  <img class="final__bee" src="${ART}/bee-fly.webp" alt="" style="left:120px;bottom:72px">
</section>`,
  ];

  return slides.map((s, i) => s(i + 1, slides.length)).join("\n");
}
