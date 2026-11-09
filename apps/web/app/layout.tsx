import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import tokens from "@teletau/design-tokens/tokens.json";
import { THEME_COOKIE, ToastProvider, parseTheme } from "@teletau/ui";
// Компоненты v2 + токены + локальные шрифты (packages/design-tokens/fonts: полные файлы со всеми башкирскими буквами).
import "@teletau/ui/ui.css";
// Оболочка на компьютере и планшете: боковая навигация вместо нижних вкладок, правая колонка.
import "@teletau/ui/shell.css";
import "./globals.css";
// Экраны ученика: тропа, урок, после урока, вкладки.
import "./_components/learn/learn.css";
// «Учусь сам» (ADR 0022): онбординг, карточка входа, цель дня.
import "./_components/learn/self.css";
// Экраны ученика в сетке оболочки: правая колонка, урок и итог на компьютере.
import "./_components/learn/shell.css";
import { ServiceWorkerRegistration } from "./_components/ServiceWorker";
import { UiModeSync } from "./_components/UiMode";

// «ТелеТау» — имя бренда, needs_native_review.
const NAME = "ТелеТау — Башкирская языковая школа";
const DESCRIPTION = "Башкирский язык каждый день: короткие уроки для детей и взрослых.";
// Картинка превью ссылки 1200×630 из утверждённых ассетов (design/scripts/make-web-assets.mjs).
const PREVIEW = { url: "/og-image.jpg", width: 1200, height: 630, alt: "Пчела над рекой и холмами Башкортостана" };

/** Адрес сайта для абсолютных ссылок превью (og:image); без PUBLIC_WEB_URL Next.js подставляет localhost. */
function siteUrl(): URL | undefined {
  try {
    return process.env.PUBLIC_WEB_URL ? new URL(process.env.PUBLIC_WEB_URL) : undefined;
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: NAME, template: "%s · ТелеТау" },
  description: DESCRIPTION,
  applicationName: "ТелеТау",
  // Иконки установки и манифест — app/manifest.ts; файлы — public/icons (design/scripts/make-web-assets.mjs).
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "ТелеТау", statusBarStyle: "default" },
  openGraph: { type: "website", siteName: "ТелеТау", locale: "ru_RU", title: NAME, description: DESCRIPTION, images: [PREVIEW] },
  twitter: { card: "summary_large_image", title: NAME, description: DESCRIPTION, images: [PREVIEW] },
};

/** theme-color: по выбранной теме (cookie), без выбора — светлый фон. */
export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: tokens[theme ?? "light"]["color.bg"],
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // CSP с nonce (proxy.ts): Next.js проставляет nonce своим скриптам только при динамическом рендеринге.
  await connection();
  // data-theme из cookie (packages/ui/src/theme.ts); без неё тема светлая.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ru" data-theme={theme ?? undefined}>
      <body>
        <a className="tt-skip-link" href="#main">
          К основному содержимому
        </a>
        <UiModeSync />
        <ServiceWorkerRegistration />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
