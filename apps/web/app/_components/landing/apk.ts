/**
 * Адрес APK для кнопки «Скачать для Android» из ANDROID_APK_URL (читает серверный компонент при запросе). Пусто или не
 * http(s) — кнопки нет.
 */
export function androidApkUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
