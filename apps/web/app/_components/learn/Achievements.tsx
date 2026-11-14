"use client";

import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import { BookOpen, Books, Fire, FlagBanner, Footprints, MapPin, Scales, SealCheck, Star, Target } from "@phosphor-icons/react/ssr";
import { Card, Dialog, ProgressBar, hexPath } from "@teletau/ui";
import { AfterScreen, useScreenSound } from "./AfterLesson";
import { useT } from "../../../i18n/client";
import type { Achievement, LessonSummary, MyAchievements } from "./model";
import "./achievements.css";

/** Значок награды (AchievementIcon контракта) — иконка Phosphor; незнакомый — звезда. */
const ICONS: Record<string, Icon> = {
  footprints: Footprints,
  "seal-check": SealCheck,
  fire: Fire,
  target: Target,
  "book-open": BookOpen,
  books: Books,
  scales: Scales,
  "map-pin": MapPin,
  "flag-banner": FlagBanner,
  star: Star,
};

/** Цвет полученной награды по значку — заливки токенов, как у сот тропы, счётчиков профиля и серии. */
const TONES: Record<string, "honey" | "streak" | "green" | "water" | "violet"> = {
  footprints: "honey",
  "seal-check": "green",
  fire: "streak",
  target: "honey",
  "book-open": "water",
  books: "water",
  scales: "violet",
  "map-pin": "green",
  "flag-banner": "green",
  star: "honey",
};

/** Геометрия соты значка по размеру (ширина, высота, «губа», скругление) — как ячейки тропы (HexNode), пропорционально. */
const SIZES = {
  tile: { w: 64, h: 56, lip: 6, r: 11 },
  medium: { w: 96, h: 84, lip: 8, r: 15 },
  hero: { w: 140, h: 122, lip: 10, r: 22 },
} as const;
type BadgeSize = keyof typeof SIZES;

const earned = (a: Achievement): boolean => Boolean(a.earnedOn);

/** «5 ноября» — день учебных суток (сервер уже посчитал его по Уфе). */
export function dayLong(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** Соты-ореол за крупным значком экрана «Новая награда». */
const HALO = { w: 260, h: 226 };

/** Сота-значок: полученная — цветная с бликом, ещё нет — воск. У наград с числом — число на ленте снизу. */
export function AchievementBadge({ achievement, size = "tile", rise }: { achievement: Achievement; size?: BadgeSize; rise?: boolean }) {
  const { w, h, lip, r } = SIZES[size];
  const Icon = ICONS[achievement.icon] ?? Star;
  const tone = earned(achievement) ? (TONES[achievement.icon] ?? "honey") : "locked";
  const cls = ["award-badge", `award-badge--${size}`, `award-badge--${tone}`, rise && "award-badge--rise"].filter(Boolean).join(" ");
  return (
    <span className={cls} aria-hidden>
      {size === "hero" && tone !== "locked" ? (
        <svg className="award-badge__halo" width={HALO.w} height={HALO.h} viewBox={`0 0 ${HALO.w} ${HALO.h}`} focusable="false">
          <path className="award-badge__halo-outer" d={hexPath(HALO.w, HALO.h, 40)} />
          <path className="award-badge__halo-inner" d={hexPath(HALO.w - 56, HALO.h - 48, 32, 28, 24)} />
        </svg>
      ) : null}
      <svg width={w} height={h + lip} viewBox={`0 0 ${w} ${h + lip}`} focusable="false">
        <path className="award-badge__lip" d={hexPath(w, h, r, 0, lip)} />
        <path className="award-badge__face" d={hexPath(w, h, r)} />
        {tone !== "locked" ? <path className="award-badge__shine" d={hexPath(w - r * 2, h - r * 2, r * 0.6, r, r * 0.7)} /> : null}
      </svg>
      <span className="award-badge__icon">
        <Icon weight="fill" />
      </span>
      {achievement.target > 1 ? <span className="award-badge__level">{achievement.target}</span> : null}
    </span>
  );
}

/** Тонкая полоса прогресса в плитке; ширина заливки — атрибутом SVG (строгая CSP). */
function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="award__bar" aria-hidden>
      {pct > 0 ? <svg className="award__bar-fill" width={`${Number(pct.toFixed(2))}%`} height="100%" focusable="false" /> : null}
    </span>
  );
}

/**
 * «Награды» в профиле: сетка сот-значков — полученные цветные, остальные воском с прогрессом. Нажатие — лист с
 * подробностями: что сделать и когда получена.
 */
export function AchievementsCard({ data }: { data: MyAchievements }) {
  const t = useT();
  const [open, setOpen] = useState<Achievement | null>(null);
  return (
    <Card as="section" className="tab-card awards" aria-labelledby="awards-title">
      <div className="awards__head">
        <h2 className="tt-card__title" id="awards-title">
          {t("Награды")}
        </h2>
        <span className="awards__count">
          {t("{n} из {total}", { n: data.earned, total: data.total })}
        </span>
      </div>
      <ul className="awards__grid">
        {data.achievements.map((a) => (
          <li key={a.id}>
            {/* Имя кнопки — видимый текст (WCAG 2.5.3); «получена» и «ещё нет» читалке — скрытым текстом. */}
            <button type="button" className={["award", earned(a) && "award--earned"].filter(Boolean).join(" ")} onClick={() => setOpen(a)}>
              <AchievementBadge achievement={a} />
              <span className="award__name">{a.titleRu}</span>
              {a.earnedOn ? (
                <span className="award__meta">
                  <span className="tt-visually-hidden">{t("Получена")} </span>
                  {dayLong(a.earnedOn)}
                </span>
              ) : a.target > 1 ? (
                <>
                  <MiniBar value={a.progress} max={a.target} />
                  <span className="award__meta">
                    {t("{n} из {total}", { n: a.progress, total: a.target })}
                  </span>
                </>
              ) : (
                <span className="tt-visually-hidden">{t("Ещё не получена")}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} title={open?.titleRu ?? ""} centered>
        {open ? (
          <div className="award-sheet">
            <AchievementBadge achievement={open} size="medium" />
            <p className="award-sheet__text">{open.descriptionRu}</p>
            {open.earnedOn ? (
              <p className="award-sheet__done">{t("Получена {date}", { date: dayLong(open.earnedOn) })}</p>
            ) : open.target > 1 ? (
              <ProgressBar value={open.progress} max={open.target} label={open.titleRu} valueText={t("{n} из {total}", { n: open.progress, total: open.target })} showValue />
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

/**
 * «Новая награда» после урока — в ряду экранов итога и серии: сота поднимается с бликом, сверху падают соты-конфетти.
 * Несколько наград за урок — все на одном экране.
 */
export function NewAchievementScreen({ summary, onContinue }: { summary: LessonSummary; onContinue: () => void }) {
  const t = useT();
  const list = summary.newAchievements ?? [];
  useScreenSound("levelUp");
  const single = list.length === 1 ? list[0] : undefined;
  return (
    <AfterScreen
      visual={single ? <AchievementBadge achievement={single} size="hero" rise /> : null}
      confetti
      action={t("Дальше")}
      onAction={onContinue}
    >
      <h1 className="after__title" tabIndex={-1}>
        {single ? t("Новая награда!") : t("Новые награды!")}
      </h1>
      {single ? (
        <p className="after__lead award-new__name">{single.titleRu}</p>
      ) : (
        <ul className="award-new__list">
          {list.map((a) => (
            <li key={a.id}>
              <AchievementBadge achievement={a} size="medium" rise />
              <span>{a.titleRu}</span>
            </li>
          ))}
        </ul>
      )}
    </AfterScreen>
  );
}
