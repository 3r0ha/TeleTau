// Оформление мест экспедиции на тропе (docs/05 §0, решения 2–3): подложка места, вывеска, иллюстрация карточки
// экспедиции и декорации. Декорации — композиция, а не сетка: один крупный «якорь», уходящий за край, рядом мелочь
// в другом масштабе и зеркально — на стороне, противоположной изгибу тропы. Координаты — из утверждённого прототипа
// (prototypes/trail-expedition, UNITS[].decos): x — от оси тропы, y — от верха дорожки юнита, w — ширина, px.
import type { IllustrationName } from "@teletau/ui";

export type PlaceTone = "honey" | "green" | "water";

/**
 * Движение декорации (learn.css, токены sway, roll, rock, leap): покачивание от основания (камыш, борть), трамвай чуть
 * катается, лодка качается на волне, рыба выпрыгивает. Камни, скалы и памятник неподвижны.
 */
export type DecoMotion = "sway" | "roll" | "rock" | "leap";

export interface Deco {
  art: IllustrationName;
  x: number;
  y: number;
  w: number;
  flip?: boolean;
  rot?: number;
  motion?: DecoMotion;
  /**
   * Низ картинки растворяется в подложке места: прозрачность от доли высоты [начало, конец] (памятнику не нужен весь
   * серый пьедестал — читается всадник на постаменте).
   */
  fade?: [number, number];
  /** На широкой колонке тропы (компьютер) — мельче: картинка не перетягивает внимание с узлов (learn.css). */
  shrinkWide?: boolean;
}

export interface PlaceArt {
  tone: PlaceTone;
  hero?: IllustrationName;
  sign?: IllustrationName;
  /** Текст вывески светлый (на зелёной вывеске Шульган-Таша). */
  signOnDark?: boolean;
  heroAlt?: string;
  decos: Deco[];
}

const PLACES: Record<string, PlaceArt> = {
  ufa: {
    tone: "honey",
    hero: "placeUfaHero",
    sign: "placeUfaSign",
    heroAlt: "Уфа: берег реки Белой и памятник Салавату Юлаеву на скале",
    decos: [
      { art: "decoUfaTram", motion: "roll", x: -118, y: 18, w: 104, rot: -3 },
      { art: "decoUfaRiverBank", x: 150, y: 70, w: 74, flip: true },
      { art: "decoUfaMonument", x: 124, y: 248, w: 156, fade: [0.54, 0.64], shrinkWide: true },
      { art: "decoUfaTram", motion: "roll", x: -142, y: 512, w: 62, flip: true },
      { art: "decoUfaRiverBank", x: -128, y: 770, w: 178 },
    ],
  },
  shulgantash: {
    tone: "green",
    hero: "placeShulgantashHero",
    sign: "placeShulgantashSign",
    signOnDark: true,
    heroAlt: "Шульган-Таш: пещера в скале, река и сосна с бортью",
    decos: [
      { art: "decoShulgantashBearPaw", x: -132, y: 46, w: 80, rot: -6 },
      { art: "decoShulgantashBort", motion: "sway", x: 138, y: 236, w: 128 },
      { art: "decoShulgantashHive", motion: "sway", x: 66, y: 318, w: 58 },
      { art: "decoShulgantashBearPaw", x: 150, y: 520, w: 52, flip: true, rot: 8 },
      { art: "decoShulgantashCave", x: -126, y: 752, w: 188 },
      { art: "decoShulgantashBort", motion: "sway", x: 152, y: 905, w: 70, flip: true },
    ],
  },
  agidel: {
    tone: "water",
    hero: "placeAgidelHero",
    sign: "placeAgidelSign",
    heroAlt: "Агидель: река между скал и каяк",
    decos: [
      { art: "decoAgidelFish", motion: "leap", x: -128, y: 36, w: 66, rot: -12 },
      { art: "decoAgidelFish", motion: "leap", x: 150, y: 150, w: 46, flip: true, rot: 10 },
      { art: "decoAgidelBoat", motion: "rock", x: 122, y: 262, w: 168, rot: -4 },
      { art: "decoAgidelReeds", motion: "sway", x: 150, y: 520, w: 48 },
      { art: "decoAgidelReeds", motion: "sway", x: -146, y: 636, w: 84 },
      { art: "decoAgidelReeds", motion: "sway", x: -96, y: 676, w: 54, flip: true },
      { art: "decoAgidelRock", x: -134, y: 880, w: 124 },
    ],
  },
  // Места 4–6 (design/prompts/places-4-6.md). Та же композиция: якорь справа там, где тропа уходит влево (узлы 1–3),
  // якорь слева там, где она уходит вправо (узлы 5–7), рядом мелочь в другом масштабе и зеркально.
  yamantau: {
    tone: "green",
    hero: "placeYamantauHero",
    sign: "placeYamantauSign",
    heroAlt: "Гора Ямантау: хребты в тумане, ельник и горная речка",
    decos: [
      { art: "decoYamantauElk", x: -128, y: 44, w: 76 },
      { art: "decoYamantauSpruce", motion: "sway", x: 152, y: 120, w: 64 },
      { art: "decoYamantauPeak", x: 120, y: 262, w: 176 },
      { art: "decoYamantauSpruce", motion: "sway", x: 58, y: 352, w: 50, flip: true },
      { art: "decoYamantauElk", x: 150, y: 540, w: 50, flip: true },
      { art: "decoYamantauSpruce", motion: "sway", x: -150, y: 622, w: 70, flip: true },
      { art: "decoYamantauWaterfall", x: -122, y: 778, w: 176 },
    ],
  },
  village: {
    tone: "honey",
    hero: "placeVillageHero",
    sign: "placeVillageSign",
    heroAlt: "Башкирская деревня: бревенчатые дома с резными наличниками, пасека и цветущий луг",
    decos: [
      { art: "decoVillageGeese", motion: "roll", x: -126, y: 44, w: 84 },
      { art: "decoVillageWell", x: 150, y: 118, w: 54 },
      { art: "decoVillageHouse", x: 120, y: 256, w: 168 },
      { art: "decoVillageHives", x: 70, y: 352, w: 72 },
      { art: "decoVillageGeese", motion: "roll", x: 148, y: 534, w: 58, flip: true },
      { art: "decoVillageHives", x: -146, y: 628, w: 84, flip: true },
      { art: "decoVillageWell", x: -124, y: 782, w: 124 },
      { art: "decoVillageHouse", x: 150, y: 904, w: 72, flip: true },
    ],
  },
  sabantuy: {
    tone: "water",
    hero: "placeSabantuyHero",
    sign: "placeSabantuySign",
    heroAlt: "Сабантуй: высокий столб с подарками, флажки, шатры и скачки на лугу",
    decos: [
      { art: "decoSabantuyHorse", motion: "rock", x: -124, y: 46, w: 94 },
      { art: "decoSabantuyFlags", motion: "sway", x: 118, y: 120, w: 120 },
      { art: "decoSabantuyPole", x: 136, y: 262, w: 98 },
      { art: "decoSabantuyFlags", motion: "sway", x: 140, y: 530, w: 76, flip: true },
      { art: "decoSabantuyHorse", motion: "rock", x: -150, y: 616, w: 62, flip: true },
      { art: "decoSabantuySwing", x: -122, y: 774, w: 164 },
      { art: "decoSabantuyPole", x: 152, y: 900, w: 54, flip: true },
    ],
  },
};

const FALLBACK: PlaceArt = { tone: "honey", decos: [] };

export function placeArt(slug: string): PlaceArt {
  return PLACES[slug] ?? FALLBACK;
}

/** Горизонтальные смещения узлов от оси тропы (prototype OFFSETS): плавная «змейка» по 8 узлов. */
export const NODE_OFFSETS = [0, -58, -86, -58, 0, 58, 86, 58] as const;
/** Высота ряда узла и середина ячейки от верха ряда, px (prototype ROW, NODE_MID). */
export const NODE_ROW = 116;
export const NODE_MID = 37;
/** Запас над текущим узлом под пузырь «Начать», px (= .track__row--current в learn.css). */
export const BUBBLE_GAP = 36;

export const offsetOf = (i: number): number => NODE_OFFSETS[i % NODE_OFFSETS.length]!;
