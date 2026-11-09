// Иллюстрации утверждённой серии (design/assets/approved, docs/15-art-brief.md §0). Подключаются импортом:
// сборщик копирует в сборку только используемые файлы, копий в репозитории нет. Ничего не рисуется кодом «на глаз».
import type { StaticImageData } from "next/image";
import appIconAlt from "../../../design/assets/approved/app-icon-alt.webp";
import appIcon from "../../../design/assets/approved/app-icon.webp";
import badgeBuckwheat from "../../../design/assets/approved/badge-buckwheat.webp";
import badgeClover from "../../../design/assets/approved/badge-clover.webp";
import badgeFireweed from "../../../design/assets/approved/badge-fireweed.webp";
import badgeLinden from "../../../design/assets/approved/badge-linden.webp";
import badgeSweetclover from "../../../design/assets/approved/badge-sweetclover.webp";
import beeCheer from "../../../design/assets/approved/bee-cheer.webp";
import beeExplain from "../../../design/assets/approved/bee-explain.webp";
import beeFly from "../../../design/assets/approved/bee-fly.webp";
import beeIdle from "../../../design/assets/approved/bee-idle.webp";
import beeProud from "../../../design/assets/approved/bee-proud.webp";
import beeRead from "../../../design/assets/approved/bee-read.webp";
import beeSleep from "../../../design/assets/approved/bee-sleep.webp";
import beeSurprise from "../../../design/assets/approved/bee-surprise.webp";
import beeSympathy from "../../../design/assets/approved/bee-sympathy.webp";
import beeTeacher from "../../../design/assets/approved/bee-teacher.webp";
import beeThink from "../../../design/assets/approved/bee-think.webp";
import decoAgidelBoat from "../../../design/assets/approved/deco-agidel-boat.webp";
import decoAgidelFish from "../../../design/assets/approved/deco-agidel-fish.webp";
import decoAgidelReeds from "../../../design/assets/approved/deco-agidel-reeds.webp";
import decoAgidelRock from "../../../design/assets/approved/deco-agidel-rock.webp";
import decoShulgantashBearPaw from "../../../design/assets/approved/deco-shulgantash-bear-paw.webp";
import decoShulgantashBort from "../../../design/assets/approved/deco-shulgantash-bort.webp";
import decoShulgantashCave from "../../../design/assets/approved/deco-shulgantash-cave.webp";
import decoShulgantashHive from "../../../design/assets/approved/deco-shulgantash-hive.webp";
import decoUfaMonument from "../../../design/assets/approved/deco-ufa-monument.webp";
import decoUfaRiverBank from "../../../design/assets/approved/deco-ufa-river-bank.webp";
import decoUfaTram from "../../../design/assets/approved/deco-ufa-tram.webp";
import decoYamantauPeak from "../../../design/assets/approved/deco-yamantau-peak.webp";
import decoYamantauSpruce from "../../../design/assets/approved/deco-yamantau-spruce.webp";
import decoYamantauWaterfall from "../../../design/assets/approved/deco-yamantau-waterfall.webp";
import decoYamantauElk from "../../../design/assets/approved/deco-yamantau-elk.webp";
import decoVillageHouse from "../../../design/assets/approved/deco-village-house.webp";
import decoVillageHives from "../../../design/assets/approved/deco-village-hives.webp";
import decoVillageWell from "../../../design/assets/approved/deco-village-well.webp";
import decoVillageGeese from "../../../design/assets/approved/deco-village-geese.webp";
import decoSabantuyPole from "../../../design/assets/approved/deco-sabantuy-pole.webp";
import decoSabantuyHorse from "../../../design/assets/approved/deco-sabantuy-horse.webp";
import decoSabantuySwing from "../../../design/assets/approved/deco-sabantuy-swing.webp";
import decoSabantuyFlags from "../../../design/assets/approved/deco-sabantuy-flags.webp";
import emptyAllDone from "../../../design/assets/approved/empty-all-done.webp";
import emptyError from "../../../design/assets/approved/empty-error.webp";
import emptyNoStudents from "../../../design/assets/approved/empty-no-students.webp";
import emptyOffline from "../../../design/assets/approved/empty-offline.webp";
import heroLanding from "../../../design/assets/approved/hero-landing.webp";
import itemStreakFreeze from "../../../design/assets/approved/item-streak-freeze.webp";
import placeAgidelHero from "../../../design/assets/approved/place-agidel-hero.webp";
import placeAgidelSign from "../../../design/assets/approved/place-agidel-sign.webp";
import placeYamantauHero from "../../../design/assets/approved/place-yamantau-hero.webp";
import placeYamantauSign from "../../../design/assets/approved/place-yamantau-sign.webp";
import placeVillageHero from "../../../design/assets/approved/place-village-hero.webp";
import placeVillageSign from "../../../design/assets/approved/place-village-sign.webp";
import placeSabantuyHero from "../../../design/assets/approved/place-sabantuy-hero.webp";
import placeSabantuySign from "../../../design/assets/approved/place-sabantuy-sign.webp";
import placeShulgantashHero from "../../../design/assets/approved/place-shulgantash-hero.webp";
import placeShulgantashSign from "../../../design/assets/approved/place-shulgantash-sign.webp";
import placeUfaHero from "../../../design/assets/approved/place-ufa-hero.webp";
import placeUfaSign from "../../../design/assets/approved/place-ufa-sign.webp";
import sceneClassHive from "../../../design/assets/approved/scene-class-hive.webp";
import sceneDuel from "../../../design/assets/approved/scene-duel.webp";
import sceneHoneyMatured from "../../../design/assets/approved/scene-honey-matured.webp";
import sceneLeagueUp from "../../../design/assets/approved/scene-league-up.webp";
import sceneLessonComplete from "../../../design/assets/approved/scene-lesson-complete.webp";
import sceneStreak from "../../../design/assets/approved/scene-streak.webp";
import sceneWordAccepted from "../../../design/assets/approved/scene-word-accepted.webp";
import avatarBee from "../../../design/assets/approved/avatar-bee.webp";
import avatarBumblebee from "../../../design/assets/approved/avatar-bumblebee.webp";
import avatarOwl from "../../../design/assets/approved/avatar-owl.webp";
import avatarHedgehog from "../../../design/assets/approved/avatar-hedgehog.webp";
import avatarFox from "../../../design/assets/approved/avatar-fox.webp";
import avatarBadger from "../../../design/assets/approved/avatar-badger.webp";
import avatarSquirrel from "../../../design/assets/approved/avatar-squirrel.webp";
import avatarBear from "../../../design/assets/approved/avatar-bear.webp";
import avatarLynx from "../../../design/assets/approved/avatar-lynx.webp";
import avatarFalcon from "../../../design/assets/approved/avatar-falcon.webp";
import avatarSwallow from "../../../design/assets/approved/avatar-swallow.webp";
import avatarCrane from "../../../design/assets/approved/avatar-crane.webp";
import avatarTit from "../../../design/assets/approved/avatar-tit.webp";
import avatarBeaver from "../../../design/assets/approved/avatar-beaver.webp";
import avatarDragonfly from "../../../design/assets/approved/avatar-dragonfly.webp";
import avatarHare from "../../../design/assets/approved/avatar-hare.webp";
import avatarMarten from "../../../design/assets/approved/avatar-marten.webp";
import avatarEagleOwl from "../../../design/assets/approved/avatar-eagle-owl.webp";
import avatarHeron from "../../../design/assets/approved/avatar-heron.webp";
import avatarDolphin from "../../../design/assets/approved/avatar-dolphin.webp";
import avatarComet from "../../../design/assets/approved/avatar-comet.webp";
import avatarCedar from "../../../design/assets/approved/avatar-cedar.webp";
import avatarStar from "../../../design/assets/approved/avatar-star.webp";
import avatarMaple from "../../../design/assets/approved/avatar-maple.webp";
import avatarChamomile from "../../../design/assets/approved/avatar-chamomile.webp";
import avatarWind from "../../../design/assets/approved/avatar-wind.webp";
import avatarBirch from "../../../design/assets/approved/avatar-birch.webp";
import avatarLighthouse from "../../../design/assets/approved/avatar-lighthouse.webp";
import avatarRowan from "../../../design/assets/approved/avatar-rowan.webp";
import avatarCompass from "../../../design/assets/approved/avatar-compass.webp";
import avatarWave from "../../../design/assets/approved/avatar-wave.webp";
import avatarSpring from "../../../design/assets/approved/avatar-spring.webp";
import avatarSun from "../../../design/assets/approved/avatar-sun.webp";
import avatarCloud from "../../../design/assets/approved/avatar-cloud.webp";
import avatarLake from "../../../design/assets/approved/avatar-lake.webp";
import avatarFeather from "../../../design/assets/approved/avatar-feather.webp";
import { avatarSlugFor, type AvatarSlug } from "./avatars";

export const illustrations = {
  appIcon,
  appIconAlt,
  badgeBuckwheat,
  badgeClover,
  badgeFireweed,
  badgeLinden,
  badgeSweetclover,
  beeCheer,
  beeExplain,
  beeFly,
  beeIdle,
  beeProud,
  beeRead,
  beeSleep,
  beeSurprise,
  beeSympathy,
  beeTeacher,
  beeThink,
  decoAgidelBoat,
  decoAgidelFish,
  decoAgidelReeds,
  decoAgidelRock,
  decoShulgantashBearPaw,
  decoShulgantashBort,
  decoShulgantashCave,
  decoShulgantashHive,
  decoUfaMonument,
  decoUfaRiverBank,
  decoUfaTram,
  decoYamantauPeak,
  decoYamantauSpruce,
  decoYamantauWaterfall,
  decoYamantauElk,
  decoVillageHouse,
  decoVillageHives,
  decoVillageWell,
  decoVillageGeese,
  decoSabantuyPole,
  decoSabantuyHorse,
  decoSabantuySwing,
  decoSabantuyFlags,
  emptyAllDone,
  emptyError,
  emptyNoStudents,
  emptyOffline,
  heroLanding,
  itemStreakFreeze,
  placeAgidelHero,
  placeAgidelSign,
  placeYamantauHero,
  placeYamantauSign,
  placeVillageHero,
  placeVillageSign,
  placeSabantuyHero,
  placeSabantuySign,
  placeShulgantashHero,
  placeShulgantashSign,
  placeUfaHero,
  placeUfaSign,
  sceneClassHive,
  sceneDuel,
  sceneHoneyMatured,
  sceneLeagueUp,
  sceneLessonComplete,
  sceneStreak,
  sceneWordAccepted,
} as const;

export type IllustrationName = keyof typeof illustrations;

/**
 * Дополнительные кадры анимации пчелы (design/prompts/batch-3-animation.md): `blink` — глаза закрыты, `wings` — крылья
 * в другом положении. Кадр обрезается по той же рамке, что основной (design/scripts/process-assets.mjs), поэтому
 * кадры накладываются один на другой без сдвига. Кадров пока нет — компонент Bee без них работает как обычная картинка.
 * Файлы кадров подключают импортом выше и записывают сюда, например
 * `beeIdle: { blink: "beeIdleBlink", wings: "beeIdleWings" }`.
 */
export const beeFrames: Partial<Record<IllustrationName, { blink?: IllustrationName; wings?: IllustrationName }>> = {};

/** Аватары ников в шестиугольной рамке (avatars.ts): имя файла → картинка. */
export const avatars: Readonly<Record<AvatarSlug, StaticImageData>> = {
  bee: avatarBee,
  bumblebee: avatarBumblebee,
  owl: avatarOwl,
  hedgehog: avatarHedgehog,
  fox: avatarFox,
  badger: avatarBadger,
  squirrel: avatarSquirrel,
  bear: avatarBear,
  lynx: avatarLynx,
  falcon: avatarFalcon,
  swallow: avatarSwallow,
  crane: avatarCrane,
  tit: avatarTit,
  beaver: avatarBeaver,
  dragonfly: avatarDragonfly,
  hare: avatarHare,
  marten: avatarMarten,
  "eagle-owl": avatarEagleOwl,
  heron: avatarHeron,
  dolphin: avatarDolphin,
  comet: avatarComet,
  cedar: avatarCedar,
  star: avatarStar,
  maple: avatarMaple,
  chamomile: avatarChamomile,
  wind: avatarWind,
  birch: avatarBirch,
  lighthouse: avatarLighthouse,
  rowan: avatarRowan,
  compass: avatarCompass,
  wave: avatarWave,
  spring: avatarSpring,
  sun: avatarSun,
  cloud: avatarCloud,
  lake: avatarLake,
  feather: avatarFeather,
};

/** Аватар ника по существительному; ник не из словаря — undefined (остаётся цветной шестиугольник). */
export function avatarFor(nickname: string | null | undefined): StaticImageData | undefined {
  const slug = avatarSlugFor(nickname);
  return slug ? avatars[slug] : undefined;
}

/** Тиры недельной лиги медоносов — от первого к пятому (docs/02, docs/07 §1.3: clover..linden). */
export const LEAGUE_TIERS = ["clover", "buckwheat", "sweetclover", "fireweed", "linden"] as const;
export type LeagueTier = (typeof LEAGUE_TIERS)[number];

/** Значок тира лиги. */
export const leagueBadges: Record<LeagueTier, IllustrationName> = {
  clover: "badgeClover",
  buckwheat: "badgeBuckwheat",
  sweetclover: "badgeSweetclover",
  fireweed: "badgeFireweed",
  linden: "badgeLinden",
};
