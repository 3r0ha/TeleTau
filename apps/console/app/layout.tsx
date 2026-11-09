import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import tokens from "@teletau/design-tokens/tokens.json";
import { THEME_COOKIE, ToastProvider, parseTheme } from "@teletau/ui";
// Те же компоненты v2, что у веба (@teletau/ui), + токены и локальные шрифты.
import "@teletau/ui/ui.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ТелеТау · Консоль", template: "%s · Консоль ТелеТау" },
  description: "Консоль модераторов и администраторов.",
  icons: { icon: [{ url: "/favicon.ico", sizes: "48x48" }] },
  // Без индексации и без превью ссылок (нет Open Graph и Twitter-карточки); заголовок X-Robots-Tag — proxy.ts.
  robots: { index: false, follow: false },
};

/** theme-color: по выбранной теме (cookie), без выбора — светлый фон. */
export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
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
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
