import type { StaticImageData } from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AndroidLogo, ChalkboardTeacher, Check } from "@phosphor-icons/react/ssr";
import createClient from "openapi-fetch";
import { Brand, ButtonLink, hexPath, illustrations } from "@teletau/ui";
import type { paths, Schema } from "@teletau/contracts";
import { API_BASE_URL } from "@teletau/session/config";
import { getT } from "../i18n/server";
import type { T } from "../i18n/core";
import { plural } from "./_components/learn/format";
import { androidApkUrl } from "./_components/landing/apk";
import { HeroActions, StartButton } from "./_components/landing/HeroActions";
import { landingImages as img } from "./_components/landing/images";
import { LandingHeader } from "./_components/landing/LandingHeader";
import { Reveal } from "./_components/landing/Reveal";
import "./_components/landing/landing.css";

/** Версия действующих документов (apps/api/src/modules/consent/legal-texts.ts); старые версии остаются доступны. */
const LEGAL_VERSION = "2026-11-01";

type Tone = "honey" | "green" | "water" | "violet";

/** Места тропы — русские строки служат ключами перевода (тема юнита, content/course/ba-ru/units/*); t() — при рендере. */
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

/** Строка доски почёта: место, группа (школа или класс) и уроки за период — без имён и ников (правило 13). */
type BoardRow = { rank: number; name: string; sub: string; lessons: number };

/** Школа на доске: название крупно, район — подписью. */
const schoolRow = (s: Schema<"PublicLeaderboardSchool">): BoardRow => ({
  rank: s.rank,
  name: s.school,
  sub: s.district,
  lessons: s.lessons,
});

/** Класс на доске: литера крупно, школа и район — подписью. */
const classRow = (c: Schema<"PublicLeaderboardClass">): BoardRow => ({
  rank: c.rank,
  name: c.classLabel,
  sub: `${c.school} · ${c.district}`,
  lessons: c.lessons,
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

/** Группа доски («Школы» или «Классы») — компактный топ-3: строка на место, из счётчиков — только уроки. */
function BoardTop({ title, rows, t }: { title: string; rows: BoardRow[]; t: T }) {
  return (
    <div className="lp-board__top">
      <h3 className="lp-board__top-title">{title}</h3>
      <div className="lp-board__sheet">
        <ol className="lp-board__rows">
          {rows.map((r) => (
            <li key={r.rank} className="lp-board__row">
              <span className="lp-board__rank">{r.rank}</span>
              <span className="lp-board__name">
                <b className="lp-board__who">{r.name}</b>
                <span className="lp-board__sub">{r.sub}</span>
              </span>
              <span className="lp-board__metric">
                {fmt(r.lessons)} {plural(r.lessons, [t("урок"), t("урока"), t("уроков")])}
              </span>
            </li>
          ))}
        </ol>
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

function AndroidButton({ href, t }: { href: string; t: T }) {
  return (
    <a className="lp-store" href={href}>
      <AndroidLogo weight="fill" aria-hidden />
      {t("Скачать для Android")}
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
  const t = await getT();
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
                alt={t("Пчела с планшетом летит над рекой и холмами")}
                fetchPriority="high"
              />
              {/* Пчела «произносит» фразу дня (ТЗ §3.6): башкирский вариант крупно, русский исходник — подписью.
                  Фразы нет или API молчит — приветствие «Сәләм!» (слово из урока «Привет!», needs_native_review,
                  docs/native-review-queue.md, №20). */}
              {phrase ? (
                <span className="lp-hero__hello">
                  <span lang="ba">{phrase.textBa}</span>
                  <span className="lp-hero__hello-ru">«{phrase.sourceRu}»</span>
                </span>
              ) : (
                <span className="lp-hero__hello" lang="ba" aria-hidden>
                  Сәләм!
                </span>
              )}
            </div>
            <div className="lp-hero__text">
              <h1 id="lp-title" className="lp-hero__title">
                {t("Учи башкирский\u00A0— легко и\u00A0каждый день")}
              </h1>
              <HeroActions />
            </div>
          </div>
        </section>

        {board && (
          <section className="lp-board" aria-labelledby="lp-board-title" data-reveal="">
            <div className="lp-wrap lp-board__in">
              <div className="lp-board__head">
                <h2 id="lp-board-title" className="lp-board__title">
                  {t("Доска почёта")}
                </h2>
                {/* Период — обычные ссылки на ту же страницу: серверный компонент, без состояния. */}
                <nav className="lp-board__periods" aria-label={t("Период доски почёта")}>
                  {BOARD_PERIODS.map((p) => (
                    <Link key={p.value} className="lp-board__period" href={`/?period=${p.value}`} aria-current={p.value === period ? "page" : undefined}>
                      {t(p.label)}
                    </Link>
                  ))}
                </nav>
              </div>
              {/* На витрине — только призёры; полная доска живёт в приложении, экран /board. */}
              <div className="lp-board__tops">
                {board.schools.length > 0 && <BoardTop title={t("Школы")} rows={board.schools.slice(0, 3).map(schoolRow)} t={t} />}
                {board.classes.length > 0 && <BoardTop title={t("Классы")} rows={board.classes.slice(0, 3).map(classRow)} t={t} />}
              </div>
              <p className="lp-board__all">
                <Link className="lp-board__all-link" href="/board">
                  {t("Вся доска — в приложении")}
                </Link>
              </p>
            </div>
          </section>
        )}

        <section className="lp-places" aria-labelledby="lp-places-title">
          <h2 id="lp-places-title" className="tt-visually-hidden">
            {t("Места тропы")}
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
                <b className="lp-place__name">{t(p.name)}</b>
                <span className="lp-place__topic">{t(p.topic)}</span>
              </li>
            ))}
          </ul>
        </section>

        <Feature
          id="lp-lessons"
          title={t("Мёд и серия")}
          text={t("Короткие уроки с пчелой: за каждый — мёд, за дни подряд — серия.")}
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
          title={t("Путь по родным местам")}
          text={t("От Уфы до Сабантуя. На каждом месте — новая тема и новые слова.")}
          art={
            <div className="lp-art lp-art--phone">
              <Stage tone="green" />
              <Pic src={img.artSpruce} className="lp-float lp-float--spruce" />
              <Phone src={img.screenTrail} alt={t("Экран тропы: место Уфа и уроки")} />
              <Pic src={img.artBoat} className="lp-float lp-float--boat" />
            </div>
          }
        />

        <Feature
          id="lp-help"
          title={t("Помоги языку")}
          text={t("Выбирай перевод, который звучит лучше. Из голосов складывается словарь башкирского.")}
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
          title={t("Лига и класс")}
          text={t("Каждую неделю — новая лига. С классом проходите общий квест.")}
          art={
            <div className="lp-art lp-art--phone">
              <Stage tone="water" />
              <Pic src={img.artBadgeClover} className="lp-float lp-float--clover" />
              <Phone src={img.screenLeague} alt={t("Экран лиги: таблица недели")} />
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
                {t("Для школ")}
              </h2>
              <ul className="lp-checks">
                <li>
                  <Check weight="bold" aria-hidden />
                  {t("Класс входит по карточкам")}
                </li>
                <li>
                  <Check weight="bold" aria-hidden />
                  {t("Задания на неделю")}
                </li>
                <li>
                  <Check weight="bold" aria-hidden />
                  {t("Видно, кто занимался")}
                </li>
              </ul>
              <ButtonLink href="/teacher/login?as=teacher" variant="secondary" icon={<ChalkboardTeacher weight="fill" aria-hidden />} className="lp-row__cta">
                {t("Кабинет учителя")}
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
                <Phone src={img.screenResult} alt={t("Экран итога урока: мёд и точность")} className="lp-phone--side" />
              </div>
            </div>
            <div className="lp-row__text">
              <h2 id="lp-apps" className="lp-h2">
                {t("Учись где удобно")}
              </h2>
              <p className="lp-lead">{t("На компьютере, планшете и телефоне.")}</p>
              {apk ? <AndroidButton href={apk} t={t} /> : null}
            </div>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="lp-final" data-reveal="">
          <div className="lp-wrap lp-final__in">
            <Pic src={img.artBeeFly} className="lp-final__bee lp-final__bee--fly" />
            <div className="lp-final__text">
              <h2 id="lp-final" className="lp-final__title">
                {t("Первый урок\u00A0— пять минут")}
              </h2>
              <StartButton />
            </div>
            <Pic src={img.artBeeCheer} className="lp-final__bee lp-final__bee--cheer" />
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <nav className="lp-foot__cols" aria-label={t("Ссылки")}>
            <div className="lp-foot__col">
              <h2 className="lp-foot__title">{t("Ученикам")}</h2>
              <ul>
                <li>
                  <Link href="/self">{t("Начать")}</Link>
                </li>
                <li>
                  <Link href="/student">{t("Войти по карточке")}</Link>
                </li>
              </ul>
            </div>
            <div className="lp-foot__col">
              <h2 className="lp-foot__title">{t("Учителям")}</h2>
              <ul>
                <li>
                  <Link href="/teacher/login?as=teacher">{t("Кабинет учителя")}</Link>
                </li>
              </ul>
            </div>
            {apk ? (
              <div className="lp-foot__col">
                <h2 className="lp-foot__title">{t("Приложение")}</h2>
                <ul>
                  <li>
                    <a href={apk}>Android</a>
                  </li>
                </ul>
              </div>
            ) : null}
            <div className="lp-foot__col">
              <h2 className="lp-foot__title">{t("Документы")}</h2>
              <ul>
                <li>
                  <Link href={`/legal/terms/${LEGAL_VERSION}`}>{t("Условия")}</Link>
                </li>
                <li>
                  <Link href={`/legal/privacy/${LEGAL_VERSION}`}>{t("Конфиденциальность")}</Link>
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
