// Картинки стартовой страницы: копии утверждённых иллюстраций и снимков экранов приложения в размере показа
// (design/scripts/landing-images.mjs). Импорт статический: сборщик отдаёт файлы с хешем в имени.
import artAccepted from "./img/art-accepted.webp";
import artAnywhere from "./img/art-anywhere.webp";
import artBadgeClover from "./img/art-badge-clover.webp";
import artBadgeFireweed from "./img/art-badge-fireweed.webp";
import artBadgeLinden from "./img/art-badge-linden.webp";
import artBeeCheer from "./img/art-bee-cheer.webp";
import artBeeFly from "./img/art-bee-fly.webp";
import artDuel from "./img/art-duel.webp";
import artBoat from "./img/art-boat.webp";
import artLessons from "./img/art-lessons.webp";
import artSchool from "./img/art-school.webp";
import artSpruce from "./img/art-spruce.webp";
import hero800 from "./img/hero-800.webp";
import placeAgidel from "./img/place-agidel.webp";
import placeSabantuy from "./img/place-sabantuy.webp";
import placeShulgantash from "./img/place-shulgantash.webp";
import placeUfa from "./img/place-ufa.webp";
import placeVillage from "./img/place-village.webp";
import placeYamantau from "./img/place-yamantau.webp";
import screenLeague from "./img/screen-league.webp";
import screenResult from "./img/screen-result.webp";
import screenTrail from "./img/screen-trail.webp";

export const landingImages = {
  artAccepted,
  artAnywhere,
  artBadgeClover,
  artBadgeFireweed,
  artBadgeLinden,
  artBeeCheer,
  artBeeFly,
  artBoat,
  artDuel,
  artLessons,
  artSchool,
  artSpruce,
  hero800,
  placeAgidel,
  placeSabantuy,
  placeShulgantash,
  placeUfa,
  placeVillage,
  placeYamantau,
  screenLeague,
  screenResult,
  screenTrail,
};

export type LandingImage = keyof typeof landingImages;
