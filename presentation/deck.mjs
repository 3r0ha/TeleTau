// Слайды презентации: разметка из небольших компонентов (сота, телефон, окно, блок схемы). Иконки — Phosphor, как
// в продукте; их SVG передаёт build.mjs (функция icon). Картинки — design/assets/approved, картинки мест — с лендинга,
// снимки экранов — shots/.

const ART = "../design/assets/approved";
const PLACE_ART = "../apps/web/app/_components/landing/img";

/** Тона сот — заливка, «губа» и светлая подложка из токенов, как у ячеек тропы, наград и мест лендинга. */
const TONES = {
  honey: ["--tt-color-accent-fill", "--tt-color-accent-lip", "--tt-color-accent-soft"],
  green: ["--tt-color-success-fill", "--tt-color-success-lip", "--tt-color-success-soft"],
  water: ["--tt-color-info-fill", "--tt-color-info-lip", "--tt-color-info-soft"],
  violet: ["--tt-color-violet-fill", "--tt-color-violet-lip", "--tt-color-violet-soft"],
  streak: ["--tt-color-streak-fill", "--tt-color-streak-lip", "--tt-color-streak-soft"],
};

/** Вершины соты с плоским верхом в рамке w×h, сжатые к центру на r (место под скругляющую обводку), сдвинутые на dy. */
function hexPoints(w, h, r, dy) {
  const cx = w / 2;
  const cy = h / 2;
  const k = 1 - (2 * r) / w;
  return [
    [w * 0.25, 0],
    [w * 0.75, 0],
    [w, h / 2],
    [w * 0.75, h],
    [w * 0.25, h],
    [0, h / 2],
  ]
    .map(([x, y]) => `${(cx + (x - cx) * k).toFixed(1)},${(cy + (y - cy) * k + dy).toFixed(1)}`)
    .join(" ");
}

/** Скруглённая сота: многоугольник с обводкой своего цвета и круглыми стыками. */
const roundHex = (w, h, r, dy, fill, stroke = fill) =>
  `<polygon points="${hexPoints(w, h, r, dy)}" fill="var(${fill})" stroke="var(${stroke})" stroke-width="${2 * r}" stroke-linejoin="round"/>`;

export function deck({ icon }) {
  /** Цветная сота со значком и бликом — как ячейки тропы и награды. */
  const hex = (tone, size, name, iconScale = 0.42) => {
    const [fill, lip] = TONES[tone];
    const w = size;
    const face = Math.round(size * 0.84);
    const lipH = Math.round(size * 0.08);
    const r = size * 0.1;
    const shine = `<path d="M ${w * 0.3} ${face * 0.22} q ${w * 0.06} ${-face * 0.09} ${w * 0.16} ${-face * 0.09}" fill="none" stroke="var(--tt-color-highlight)" stroke-opacity="0.55" stroke-width="${Math.max(3, w * 0.035)}" stroke-linecap="round"/>`;
    const svg = `<svg class="hex__shape" viewBox="0 0 ${w} ${face + lipH}" aria-hidden="true">${roundHex(w, face, r, lipH, lip)}${roundHex(w, face, r, 0, fill)}${shine}</svg>`;
    const s = Math.round(w * iconScale);
    return `<div class="hex" style="width:${w}px;height:${face + lipH}px">${svg}<div class="hex__icon" style="width:${s}px;height:${s}px;margin-bottom:${lipH}px">${icon(name)}</div></div>`;
  };

  /** Сота места: светлая подложка с цветной обводкой и «губой», внутри — картинка места (как на лендинге). */
  const place = (tone, slug, name, topic) => {
    const [fill, lip, soft] = TONES[tone];
    const w = 112;
    const face = 97;
    const lipH = 8;
    const r = 11;
    const svg = `<svg class="hex__shape" viewBox="0 0 ${w} ${face + lipH}" aria-hidden="true">${roundHex(w, face, r, lipH, lip)}${roundHex(w, face, r, 0, fill)}${roundHex(w, face, r + 4, 0, soft)}</svg>`;
    return `<div class="place"><div class="hex" style="width:${w}px;height:${face + lipH}px">${svg}<img class="place__art" src="${PLACE_ART}/place-${slug}.webp" alt=""></div><b>${name}</b><span>${topic}</span></div>`;
  };

  /** Блок схемы архитектуры: значок, название, технологии; later — пунктир и метка «дальше». */
  const box = (name, tech, { later = false, iconName } = {}) =>
    `<div class="box${later ? " box--later" : ""}">${iconName ? `<span class="box__icon">${icon(iconName)}</span>` : ""}<b>${name}</b><span>${tech}</span>${later ? '<i class="box__tag">дальше</i>' : ""}</div>`;

  const phone = (src, cls = "") => `<div class="phone ${cls}"><img src="shots/${src}" alt=""></div>`;
  const win = (src) => `<div class="window"><div class="window__bar"><i></i><i></i><i></i></div><img src="shots/${src}" alt=""></div>`;
  /** Полноэкранный слайд-снимок: один скрин на весь слайд, короткий заголовок, без текста — рассказ голосом. */
  const full = (n, tag, src) => `
<section class="slide slide--full">
  <h2 class="title">${tag}</h2>
  <img class="full__img" src="shots/${src}" alt="">
  ${foot(n)}
</section>`;
  const brand = `<div class="brand"><img src="${ART}/app-icon.webp" alt="">ТелеТау</div>`;
  const foot = (n) => `<div class="foot">${brand}<span>${n}</span></div>`;

  const slides = [
    // Обложка
    () => `
<section class="slide cover">
  <div>
    <div class="brand"><img src="${ART}/app-icon.webp" alt="">ТелеТау</div>
    <p class="cover__sub">Башкирская языковая школа</p>
    <h1 class="cover__title">Платформа для изучения башкирского языка</h1>
    <p class="lead">Для школьников, учителей и&nbsp;взрослых. Сайт, iOS, Android и&nbsp;Telegram.</p>
  </div>
  <div class="cover__art">
    <img src="${ART}/hero-landing.webp" alt="">
    <div class="bubble" style="top:21%;right:62%">Сәләм!</div>
  </div>
</section>`,

    // Архитектура
    (n) => `
<section class="slide arch-slide">
  <h2 class="title">Архитектура</h2>
  <div class="arch">
    <div class="arch__main">
      <p class="arch__label">Клиенты</p>
      <div class="arch__row arch__row--5">
        ${box("Сайт и кабинет учителя", "Next.js 16, React 19", { iconName: "Browser" })}
        ${box("Консоль министерства и&nbsp;Фонда", "Next.js 16", { iconName: "ChartBar" })}
        ${box("iOS", "Swift 6, SwiftUI", { iconName: "AppleLogo" })}
        ${box("Android", "Kotlin, Jetpack Compose", { iconName: "AndroidLogo" })}
        ${box("Telegram", "бот на grammY, Mini App", { iconName: "TelegramLogo" })}
      </div>
      <p class="arch__label">Сервер</p>
      <div class="arch__api">
        <div class="arch__api-head"><b>API: модульный монолит</b><span>TypeScript, NestJS, Fastify</span></div>
        <div class="chips">
          ${["Вход и сессии", "Школы и классы", "Согласия", "Курс", "Уроки и повторение", "Прогресс и серия", "Лиги", "Корпус переводов", "Голоса", "Задания", "Министерство", "Модерация", "Telegram", "Аудит"].map((m) => `<span class="chip">${m}</span>`).join("")}
        </div>
      </div>
      <p class="arch__label">Данные и сервисы</p>
      <div class="arch__row arch__row--4">
        ${box("PostgreSQL 17", "Drizzle ORM, 14 миграций", { iconName: "Database" })}
        ${box("Valkey", "лимиты запросов, идемпотентность", { iconName: "Lightning" })}
        ${box("ИИ-шлюз → GigaChat", "бюджеты, кеш, удаление ПДн", { later: true, iconName: "Sparkle" })}
        ${box("ClickHouse", "обезличенная аналитика", { later: true, iconName: "ChartLine" })}
      </div>
    </div>
    <div class="arch__side">
      <div class="rule">${icon("Flask")}<div><b>10 наборов тест-векторов</b><p>Башкирский текст, проверка ответа, FSRS-6, серия, мёд, награды, голоса, QR-карточки. Правило, которое есть и&nbsp;на&nbsp;сервере, и&nbsp;в&nbsp;приложениях, проверяется одними векторами на&nbsp;TypeScript, Swift и&nbsp;Kotlin</p></div></div>
      <div class="rule">${icon("TextAa")}<div><b>Башкирские буквы</b><p>Один пакет нормализации: ҡ вместо казахской қ, латинская h&nbsp;→&nbsp;һ. Ответ «к» вместо «ҡ» засчитывается как «почти»</p></div></div>
      <div class="rule">${icon("ShieldCheck")}<div><b>Данные детей</b><p>Имя, телефон и&nbsp;почту ребёнка не&nbsp;собираем. Данные взрослых хранятся в&nbsp;отдельной схеме, в&nbsp;логах их&nbsp;нет</p></div></div>
      <div class="rule">${icon("Lock")}<div><b>Безопасность веба</b><p>Строгая CSP с&nbsp;nonce, токен обновления в&nbsp;httpOnly-cookie. Без Firebase и&nbsp;Google Analytics</p></div></div>
    </div>
  </div>
  ${foot(n)}
</section>`,

    // Курс
    (n) => `
<section class="slide">
  <div class="split">
    <div>
      <h2 class="title">Курс: шесть мест Башкортостана</h2>
      <ul class="points">
        <li>${hex("honey", 84, "Timer")}<span>В уроке 8 упражнений, около <b>5 минут</b></span></li>
        <li>${hex("violet", 84, "Student")}<span>Ученик входит по&nbsp;<b>QR‑карточке</b> или коду класса. Имя и&nbsp;телефон не&nbsp;нужны</span></li>
      </ul>
      <div class="places">
        ${place("honey", "ufa", "Уфа", "Знакомство")}
        ${place("green", "shulgantash", "Шульган‑Таш", "Семья")}
        ${place("water", "agidel", "Агидель", "Природа")}
        ${place("green", "yamantau", "Ямантау", "Числа и время")}
        ${place("honey", "village", "Деревня", "Еда")}
        ${place("violet", "sabantuy", "Сабантуй", "Праздники")}
      </div>
    </div>
    <div class="phones">${phone("trail.png")}${phone("trail-second.png")}</div>
  </div>
  ${foot(n)}
</section>`,

    // Урок
    (n) => `
<section class="slide">
  <h2 class="title">Урок</h2>
  <div class="phones phones--row">
    ${phone("lesson-tiles.png", "phone--md")}
    ${phone("lesson-input.png", "phone--md")}
    ${phone("lesson-word.png", "phone--md")}
    ${phone("result.png", "phone--md")}
  </div>
  ${foot(n)}
</section>`,

    // Мотивация
    (n) => `
<section class="slide">
  <h2 class="title">Мотивация</h2>
  <div class="phones phones--row">
    ${phone("league.png", "phone--lg")}
    ${phone("awards.png", "phone--lg")}
  </div>
  ${foot(n)}
</section>`,

    // Помоги языку
    (n) => `
<section class="slide">
  <h2 class="title">«Помоги языку»</h2>
  <div class="phones phones--row">
    ${phone("duel.png", "phone--lg")}
    ${phone("duel-groups.png", "phone--lg")}
  </div>
  ${foot(n)}
</section>`,

    // Сайт, словарь и доска — снимки стенда, целиком на слайд
    (n) => full(n, "Сайт на башкирском", "landing-ba.png"),
    (n) => full(n, "Публичный словарь", "dictionary.png"),
    (n) => full(n, "Доска почёта", "landing-board.png"),

    // Кабинет учителя и консоль — снимки целиком
    (n) => full(n, "Кабинет учителя", "teacher-home.png"),
    (n) => full(n, "Прогресс класса", "teacher-progress.png"),
    (n) => full(n, "Министерство", "ministry.png"),
    (n) => full(n, "Фонд языка", "fund.png"),

    // Мобильные приложения
    (n) => `
<section class="slide">
  <h2 class="title">Мобильные приложения</h2>
  <div class="phones phones--row">
    ${phone("android-welcome.png", "phone--md")}
    ${phone("android-board.png", "phone--md")}
    ${phone("ios-trail.png", "phone--md")}
    ${phone("miniapp.png", "phone--md")}
  </div>
  ${foot(n)}
</section>`,

    // Что готово
    (n) => `
<section class="slide slide--center">
  <h2 class="title">Что готово</h2>
  <div class="numbers">
    <div class="number">${hex("honey", 104, "MapTrifold")}<div><div class="number__val">6 мест</div><p class="number__text">от Уфы до Сабантуя</p></div></div>
    <div class="number">${hex("water", 104, "BookOpen")}<div><div class="number__val">35 уроков</div><p class="number__text">281 упражнение</p></div></div>
    <div class="number">${hex("violet", 104, "Scales")}<div><div class="number__val">86 пар</div><p class="number__text">в открытом словаре: баш—рус 36, баш—каз 50</p></div></div>
    <div class="number">${hex("green", 104, "SpeakerHigh")}<div><div class="number__val">35 слов</div><p class="number__text">с записью носителя</p></div></div>
    <div class="number">${hex("streak", 104, "Translate")}<div><div class="number__val">3 языка</div><p class="number__text">интерфейса: русский, башкирский, казахский</p></div></div>
    <div class="number">${hex("honey", 104, "DeviceMobile")}<div><div class="number__val">4 платформы</div><p class="number__text">сайт, iOS, Android, Telegram</p></div></div>
  </div>
  ${foot(n)}
</section>`,

    // Дальше
    (n) => `
<section class="slide slide--center">
  <h2 class="title">Дальше</h2>
  <div class="next">
    <div class="card">${hex("honey", 110, "Chalkboard")}<h3>Пилот в школах</h3><p>Классы в нескольких районах республики</p></div>
    <div class="card">${hex("violet", 110, "Sparkle")}<h3>Подсказки GigaChat</h3><p>Объяснения ошибок на&nbsp;русском. Башкирский текст от&nbsp;модели помечается как непроверенный</p></div>
    <div class="card">${hex("green", 110, "Books")}<h3>Открытый словарь</h3><p>Выпуски проверенных пар для Фонда и&nbsp;разработчиков</p></div>
  </div>
  ${foot(n)}
</section>`,

    // Финал
    () => `
<section class="slide final">
  <div class="final__bees"><img src="${ART}/bee-fly.webp" alt=""><img src="${ART}/bee-cheer.webp" alt=""></div>
  <div class="brand final__brand"><img src="${ART}/app-icon.webp" alt="">ТелеТау</div>
  <div class="final__url">teletau.study</div>
</section>`,
  ];

  return slides.map((s, i) => s(i + 1)).join("\n");
}
