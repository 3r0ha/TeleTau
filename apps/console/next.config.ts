import type { NextConfig } from "next";

// Демо с телефона в той же сети: сайт открыт по адресу компьютера (PUBLIC_WEB_URL / PUBLIC_CONSOLE_URL), а Next.js в dev
// по умолчанию блокирует свои скрипты для «чужого» хоста — страница видна, но кнопки не работают. Разрешаем эти хосты.
const devHosts = [
  // Next в dev пускает только localhost и хост запуска: 127.0.0.1 в списке нет — без записи страница, открытая по
  // http://127.0.0.1:3100, не гидратируется (HMR-сокет отклоняется, «страница видна, но кнопки не работают»).
  "127.0.0.1",
  process.env.PUBLIC_WEB_URL,
  process.env.PUBLIC_CONSOLE_URL,
]
  .flatMap((entry) => {
    if (!entry) return [];
    try {
      return [new URL(entry).hostname];
    } catch {
      // Не URL — уже имя хоста (например, 127.0.0.1).
      return [entry];
    }
  })
  .filter((host) => host !== "localhost");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: devHosts,
  // Значок Next.js в углу экрана в pnpm dev перекрывает интерфейс; ошибки dev-сервер всё равно показывает.
  devIndicators: false,
  // Общие пакеты без сборки (исходники TS/TSX и CSS): @teletau/ui — компоненты, @teletau/session — сессия и BFF.
  transpilePackages: ["@teletau/design-tokens", "@teletau/ui", "@teletau/session"],
};

export default config;
