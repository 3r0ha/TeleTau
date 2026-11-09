"use client";

import { useEffect } from "react";

/**
 * Подключает public/sw.js: без сети он показывает «Нет связи» вместо ошибки браузера. Service worker есть только
 * в защищённом контексте (https, localhost); по http в локальной сети сайт работает без него.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
