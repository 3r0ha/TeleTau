import type { StaticImageData } from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AndroidLogo, ChalkboardTeacher, Check } from "@phosphor-icons/react/ssr";
import createClient from "openapi-fetch";
import { Brand, ButtonLink, hexPath, illustrations } from "@teletau/ui";
import type { paths, Schema } from "@teletau/contracts";
import { API_BASE_URL } from "@teletau/session/config";
import { androidApkUrl } from "./_components/landing/apk";
import { HeroActions, StartButton } from "./_components/landing/HeroActions";
import { landingImages as img } from "./_components/landing/images";
import { LandingHeader } from "./_components/landing/LandingHeader";
import { Reveal } from "./_components/landing/Reveal";
import "./_components/landing/landing.css";

/** Версия действующих документов (apps/api/src/modules/consent/legal-texts.ts); старые версии остаются доступны. */
const LEGAL_VERSION = "2026-11-01";

type Tone = "honey" | "green" | "water" | "violet";

/** Места тропы — по-русски, с темой юнита (content/course/ba-ru/units/*). */
const PLACES: { name: string; topic: string; art: StaticImageData; tone: Tone }[] = [
  { name: "Уфа", topic: "Знакомство", art: img.placeUfa, tone: "honey" },
  { name: "Шульган-Таш", topic: "Семья", art: img.placeShulgantash, tone: "green" },
  { name: "Агидель", topic: "Природа", art: img.placeAgidel, tone: "water" },
  { name: "Ямантау", topic: "Числа и время", art: img.placeYamantau, tone: "green" },
  { name: "Деревня", topic: "Еда", art: img.placeVillage, tone: "honey" },
  { name: "Сабантуй", topic: "Праздники и игры", art: img.placeSabantuy, tone: "violet" },
];

const CELL = { w: 96, h: 84, lip: 6 };
const CELL_FACE = hexPath(CELL.w, CELL.h, 12, 0, 0);
const CELL_LIP = hexPath(CELL.w, CELL.h, 12, 0, CELL.lip);
const STAGE = hexPath(400, 346, 44);

/** Фраза дня (ТЗ §3.6) — публичная витрина без регистрации. API недоступен или пар ещё нет — блока нет. */
async function loadPhrase(): Promise<Schema<"PhraseOfDay">["pair"] | null> {
  try {
    // Таймаут (docs/06 §6.8): лендинг не ждёт молчащего API, без блока — не страшно.
    const api = createClient<paths>({ baseUrl: API_BASE_URL, fetch: (r) => fetch(r, { cache: "no-store", signal: AbortSignal.timeout(10_000) }) });
    const { data } = await api.GET("/api/v1/public/phrase-of-day");
    return data?.pair ?? null;
  } catch {
    return null;
  }
}

/** Периоды доски почёта (ТЗ §4.5): учебные сутки, неделя (по умолчанию), месяц, год — по Уфе. */
type BoardPeriod = Schema<"PublicLeaderboard">["period"];

const BOARD_PERIODS: { value: BoardPeriod; label: string }[] = [
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
];

/** Доска почёта (ТЗ §4.5) — публичная витрина без регистрации. API молчит или данных нет — блока нет. */
async function loadLeaderboard(period: BoardPeriod): Promise<Schema<"PublicLeaderboard"> | null> {
  try {
    // Таймаут (docs/06 §6.8): лендинг не ждёт молчащего API, без блока — не страшно.
    const api = createClient<paths>({ baseUrl: API_BASE_URL, fetch: (r) => fetch(r, { cache: "no-store", signal: AbortSignal.timeout(10_000) }) });
    const { data } = await api.GET("/api/v1/public/leaderboard", { params: { query: { period } } });
    // Пустые списки — данных ещё нет (контракт getPublicLeaderboard): секцию не показываем.
    return data && (data.schools.length > 0 || data.classes.length > 0) ? data : null;
  } catch {
    return null;
  }
}

/** Число с разрядами по-русски: 1234 → «1 234». */
const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Родительный падеж после «не меньше»: 5 → «учеников», 21 → «ученика». */
const genitiveStudents = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "ученика" : "учеников");

/** Строка доски почёта: место, группа (школа или класс) и три счётчика — без имён и ников (правило 13). */
type BoardRow = { rank: number; name: string; sub: string; lessons: number; activeStudents: number; wordsLearned: number };

/** Школа на доске: название крупно, район — подписью. */
const schoolRow = (s: Schema<"PublicLeaderboardSchool">): BoardRow => ({
  rank: s.rank,
  name: s.school,
  sub: s.district,
  lessons: s.lessons,
  activeStudents: s.activeStudents,
  wordsLearned: s.wordsLearned,
});

/** Класс на доске: литера крупно, школа и район — подписью. */
const classRow = (c: Schema<"PublicLeaderboardClass">): BoardRow => ({
  rank: c.rank,
  name: c.classLabel,
  sub: `${c.school} · ${c.district}`,
  lessons: c.lessons,
  activeStudents: c.activeStudents,
  wordsLearned: c.wordsLearned,
});

/** Картинка в размере показа: ширина — из CSS, высота — по пропорции файла. */
function Pic({ src, alt = "", className }: { src: StaticImageData; alt?: string; className?: string }) {
  return <img className={className} src={src.src} width={src.width} height={src.height} alt={alt} loading="lazy" decoding="async" />;
}

/** Телефон с настоящим снимком экрана приложения. */
function Phone({ src, alt, className }: { src: StaticImageData; alt: string; className?: string }) {
  return (
    <div className={["lp-phone", className].filter(Boolean).join(" ")}>
      <img className="lp-phone__screen" src={src.src} width={src.width} height={src.height} alt={alt} loading="lazy" decoding="async" />
    </div>
  );
}

/** Большая сота за картинкой раздела. */
function Stage({ tone }: { tone: Tone }) {
  return (
    <svg className={`lp-stage lp-stage--${tone}`} viewBox="0 0 400 346" aria-hidden focusable="false">
      <path d={STAGE} />
    </svg>
  );
}

/** Группа доски почёта («Школы» или «Классы») — компактная таблица: место, группа, уроки, ученики, слова. */
function BoardTable({ title, nameHeader, rows }: { title: string; nameHeader: string; rows: BoardRow[] }) {
  return (
    <div className="lp-board__group">
      <h3 className="lp-board__group-title">{title}</h3>
      <div className="lp-board__sheet">
        <table className="lp-board__table">
          <thead>
            <tr>
              <th className="lp-board__th" scope="col">
                №
              </th>
              <th className="lp-board__th lp-board__th--name" scope="col">
                {nameHeader}
              </th>
              <th className="lp-board__th lp-board__th--num" scope="col">
                Уроки
              </th>
              <th className="lp-board__th lp-board__th--num" scope="col">
                Ученики
              </th>
              <th className="lp-board__th lp-board__th--num" scope="col">
                Слова
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rank}>
                <td className="lp-board__rank">{r.rank}</td>
                <td className="lp-board__name">
                  <b className="lp-board__who">{r.name}</b>
                  <span className="lp-board__sub">{r.sub}</span>
                </td>
                <td className="lp-board__num">{fmt(r.lessons)}</td>
                <td className="lp-board__num">{fmt(r.activeStudents)}</td>
                <td className="lp-board__num">{fmt(r.wordsLearned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Раздел о продукте: картинка и текст, на компьютере — в ряд, через один зеркально. */
function Feature({ id, title, text, art, flip, children }: { id: string; title: string; text: string; art: ReactNode; flip?: boolean; children?: ReactNode }) {
  return (
    <section className={["lp-row", flip && "lp-row--flip"].filter(Boolean).join(" ")} aria-labelledby={id} data-reveal="">
      <div className="lp-wrap lp-row__in">
        <div className="lp-row__art">{art}</div>
        <div className="lp-row__text">
          <h2 id={id} className="lp-h2">
            {title}
          </h2>
          <p className="lp-lead">{text}</p>
          {children}
        </div>
      </div>
    </section>
  );
}

function AndroidButton({ href }: { href: string }) {
  return (
    <a className="lp-store" href={href}>
      <AndroidLogo weight="fill" aria-hidden />
      Скачать для Android
    </a>
  );
}

/**
 * Стартовая страница — лендинг: шапка с «Войти», герой с двумя кнопками, фраза дня и доска почёта школ
 * и классов (когда API отвечает), полоса мест тропы, четыре раздела о продукте через один, раздел для школ,
 * приложение, финальный призыв и подвал со ссылками. Кнопка Android — только если задан
 * ANDROID_APK_URL (читается при каждом запросе).
 */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  await connection();
  const apk = androidApkUrl(process.env.ANDROID_APK_URL);
  const hero = illustrations.heroLanding;
  // Период доски из адреса; невалидное или потерянное значение — неделя (контракт getPublicLeaderboard).
  const rawPeriod = (await searchParams).period;
  const period = BOARD_PERIODS.find((p) => p.value === rawPeriod)?.value ?? "week";
  // Фраза и доска грузятся вместе: молчащий API не удлиняет ответ витрины.
  const [phrase, board] = await Promise.all([loadPhrase(), loadLeaderboard(period)]);

  return (
    <>
      <LandingHeader />
      <main id="main" className="lp">
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-wrap lp-hero__in">
            <div className="lp-hero__art">
              <img
                className="lp-hero__img"
                src={hero.src}
                srcSet={`${img.hero800.src} ${img.hero800.width}w, ${hero.src} ${hero.width}w`}
                sizes="(min-width: 1024px) 760px, calc(100vw - 32px)"
                width={hero.width}
                height={hero.height}
                alt="Пчела с планшетом летит над рекой и холмами"
                fetchPriority="high"
              />
              {/* Слово из урока «Привет!» курса, needs_native_review (docs/native-review-queue.md, №20). */}
              <span className="lp-hero__hello" lang="ba" aria-hidden>
                Сәләм!
              </span>
            </div>
            <div className="lp-hero__text">
              <h1 id="lp-title" className="lp-hero__title">
                Учи башкирский&nbsp;— легко и&nbsp;каждый день
              </h1>
              <HeroActions />
            </div>
          </div>
        </section>

        {phrase && (
          <section className="lp-phrase" aria-labelledby="lp-phrase-title">
            <div className="lp-wrap lp-phrase__in">
              <h2 id="lp-phrase-title" className="lp-phrase__title">
                Фраза дня
              </h2>
              <div className="lp-phrase__say">
                {/* Пчела «произносит» фразу дня — пузырь как «Сәләм!» в герое; пчела с книгой — пара из словаря. */}
                <span className="lp-cell lp-phrase__bee" aria-hidden>
                  <svg viewBox={`0 0 ${CELL.w} ${CELL.h + CELL.lip}`} focusable="false">
                    <path className="lp-cell__lip" d={CELL_LIP} />
                    <path className="lp-cell__face" d={CELL_FACE} />
                  </svg>
                  <Pic src={illustrations.beeRead} className="lp-cell__art" />
                </span>
                <p className="lp-phrase__ba" lang="ba">
                  {phrase.textBa}
                </p>
              </div>
              <p className="lp-phrase__ru">«{phrase.sourceRu}»</p>
              <p className="lp-phrase__note">Принятая пара словаря ТелеТау: за перевод проголосовали ученики и взрослые</p>
            </div>
          </section>
        )}

        {board && (
          <section className="lp-board" aria-labelledby="lp-board-title" data-reveal="">
            <div className="lp-wrap lp-board__in">
              <div className="lp-board__head">
                <h2 id="lp-board-title" className="lp-h2">
                  Доска почёта
                </h2>
                <p className="lp-lead">Самые активные школы и классы. Места — целым группам: ни имён, ни ников.</p>
                {/* Период — обычные ссылки на ту же страницу: серверный компонент, без состояния. */}
                <nav className="lp-board__periods" aria-label="Период доски почёта">
                  {BOARD_PERIODS.map((p) => (
                    <Link key={p.value} className="lp-board__period" href={`/?period=${p.value}`} aria-current={p.value === period ? "page" : undefined}>
                      {p.label}
                    </Link>
                  ))}
                </nav>
                {/* T00:00 — местная полночь: дата без сдвига на часовой пояс сервера. */}
                <p className="lp-board__since">с {new Date(`${board.periodStart}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · время по Уфе</p>
              </div>
              <div className="lp-board__groups">
                {board.schools.length > 0 && <BoardTable title="Школы" nameHeader="Школа" rows={board.schools.map(schoolRow)} />}
                {board.classes.length > 0 && <BoardTable title="Классы" nameHeader="Класс" rows={board.classes.map(classRow)} />}
              </div>
              <p className="lp-board__note">
                В доску попадают школы и классы, где за период занималось не меньше {board.smallGroupThreshold} {genitiveStudents(board.smallGroupThreshold)}.
              </p>
            </div>
          </section>
        )}

        <section className="lp-places" aria-labelledby="lp-places-title">
          <h2 id="lp-places-title" className="tt-visually-hidden">
            Места тропы
          </h2>
          <ul className="lp-wrap lp-places__list">
            {PLACES.map((p) => (
              <li key={p.name} className="lp-place">
                <span className={`lp-cell lp-cell--${p.tone}`} aria-hidden>
                  <svg viewBox={`0 0 ${CELL.w} ${CELL.h + CELL.lip}`} focusable="false">
                    <path className="lp-cell__lip" d={CELL_LIP} />
                    <path className="lp-cell__face" d={CELL_FACE} />
                  </svg>
                  <Pic src={p.art} className="lp-cell__art" />
                </span>
                <b className="lp-place__name">{p.name}</b>
                <span className="lp-place__topic">{p.topic}</span>
              </li>
            ))}
          </ul>
        </section>

        <Feature
          id="lp-lessons"
          title="Мёд и серия"
          text="Короткие уроки с пчелой: за каждый — мёд, за дни подряд — серия."
          art={
            <div className="lp-art">
              <Stage tone="honey" />
              <Pic src={img.artLessons} className="lp-art__main" />
            </div>
          }
        />

        <Feature
          id="lp-trail"
          flip
          title="Путь по родным местам"
          text="От Уфы до Сабантуя. На каждом месте — новая тема и новые слова."
          art={
            <div className="lp-art lp-art--phone">
              <Stage tone="green" />
              <Pic src={img.artSpruce} className="lp-float lp-float--spruce" />
              <Phone src={img.screenTrail} alt="Экран тропы: место Уфа и уроки" />
              <Pic src={img.artBoat} className="lp-float lp-float--boat" />
            </div>
          }
        />

        <Feature
          id="lp-help"
          title="Помоги языку"
          text="Выбирай перевод, который звучит лучше. Из голосов складывается словарь башкирского."
          art={
            <div className="lp-art">
              <Stage tone="violet" />
              <Pic src={img.artDuel} className="lp-art__main lp-art__main--duel" />
              <Pic src={img.artAccepted} className="lp-float lp-float--accepted" />
            </div>
          }
        />

        <Feature
          id="lp-league"
          flip
          title="Лига и класс"
          text="Каждую неделю — новая лига. С классом проходите общий квест."
          art={
            <div className="lp-art lp-art--phone">
              <Stage tone="water" />
              <Pic src={img.artBadgeClover} className="lp-float lp-float--clover" />
              <Phone src={img.screenLeague} alt="Экран лиги: таблица недели" />
              <Pic src={img.artBadgeLinden} className="lp-float lp-float--linden" />
              <Pic src={img.artBadgeFireweed} className="lp-float lp-float--fireweed" />
            </div>
          }
        />

        <section className="lp-band lp-school" aria-labelledby="lp-school" data-reveal="">
          <div className="lp-wrap lp-row__in">
            <div className="lp-row__art">
              <div className="lp-art">
                <Stage tone="honey" />
                <Pic src={img.artSchool} className="lp-art__main lp-art__main--school" />
              </div>
            </div>
            <div className="lp-row__text">
              <h2 id="lp-school" className="lp-h2">
                Для школ
              </h2>
              <ul className="lp-checks">
                <li>
                  <Check weight="bold" aria-hidden />
                  Класс входит по карточкам
                </li>
                <li>
                  <Check weight="bold" aria-hidden />
                  Задания на неделю
                </li>
                <li>
                  <Check weight="bold" aria-hidden />
                  Видно, кто занимался
                </li>
              </ul>
              <ButtonLink href="/teacher/login?as=teacher" variant="secondary" icon={<ChalkboardTeacher weight="fill" aria-hidden />} className="lp-row__cta">
                Кабинет учителя
              </ButtonLink>
            </div>
          </div>
        </section>

        <section className="lp-row lp-apps" aria-labelledby="lp-apps" data-reveal="">
          <div className="lp-wrap lp-row__in">
            <div className="lp-row__art">
              <div className="lp-art lp-art--anywhere">
                <Stage tone="honey" />
                <Pic src={img.artAnywhere} className="lp-art__main lp-art__main--anywhere" />
                <Phone src={img.screenResult} alt="Экран итога урока: мёд и точность" className="lp-phone--side" />
              </div>
            </div>
            <div className="lp-row__text">
              <h2 id="lp-apps" className="lp-h2">
                Учись где удобно
              </h2>
              <p className="lp-lead">На компьютере, планшете и телефоне.</p>
              {apk ? <AndroidButton href={apk} /> : null}
            </div>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="lp-final" data-reveal="">
          <div className="lp-wrap lp-final__in">
            <Pic src={img.artBeeFly} className="lp-final__bee lp-final__bee--fly" />
            <div className="lp-final__text">
              <h2 id="lp-final" className="lp-final__title">
                Первый урок&nbsp;— пять минут
              </h2>
              <StartButton />
            </div>
            <Pic src={img.artBeeCheer} className="lp-final__bee lp-final__bee--cheer" />
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <nav className="lp-foot__cols" aria-label="Ссылки">
            <div className="lp-foot__col">
              <h2 className="lp-foot__title">Ученикам</h2>
              <ul>
                <li>
                  <Link href="/self">Начать</Link>
                </li>
                <li>
                  <Link href="/student">Войти по карточке</Link>
                </li>
              </ul>
            </div>
            <div className="lp-foot__col">
              <h2 className="lp-foot__title">Учителям</h2>
              <ul>
                <li>
                  <Link href="/teacher/login?as=teacher">Кабинет учителя</Link>
                </li>
              </ul>
            </div>
            {apk ? (
              <div className="lp-foot__col">
                <h2 className="lp-foot__title">Приложение</h2>
                <ul>
                  <li>
                    <a href={apk}>Android</a>
                  </li>
                </ul>
              </div>
            ) : null}
            <div className="lp-foot__col">
              <h2 className="lp-foot__title">Документы</h2>
              <ul>
                <li>
                  <Link href={`/legal/terms/${LEGAL_VERSION}`}>Условия</Link>
                </li>
                <li>
                  <Link href={`/legal/privacy/${LEGAL_VERSION}`}>Конфиденциальность</Link>
                </li>
              </ul>
            </div>
          </nav>
          <div className="lp-foot__brand">
            <Brand />
          </div>
        </div>
      </footer>
      <Reveal />
    </>
  );
}
