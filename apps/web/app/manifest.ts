import type { MetadataRoute } from "next";
import tokens from "@teletau/design-tokens/tokens.json";

/**
 * Установка сайта иконкой на экран. Старт — тропа ученика (/learn): без сессии она ведёт на вход по карточке.
 * Иконки — из утверждённой app-icon (design/scripts/make-web-assets.mjs).
 */
export default function manifest(): MetadataRoute.Manifest {
  // «ТелеТау» — имя бренда, needs_native_review.
  return {
    id: "/",
    name: "ТелеТау — Башкирская языковая школа",
    short_name: "ТелеТау",
    description: "Башкирский язык каждый день: короткие уроки для детей и взрослых.",
    lang: "ru",
    dir: "ltr",
    start_url: "/learn",
    scope: "/",
    display: "standalone",
    background_color: tokens.light["color.bg"],
    theme_color: tokens.light["color.bg"],
    categories: ["education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
