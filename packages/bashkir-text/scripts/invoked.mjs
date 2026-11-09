import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * true, если модуль запущен напрямую (`node script.mjs`), а не импортирован.
 * Сравниваются реальные пути — устойчиво к симлинкам (`/var` → `/private/var` на macOS).
 * Копия `scripts/lib/invoked.mjs` из корня: пакет не импортирует файлы вне своей папки.
 */
export function isInvokedDirectly(metaUrl) {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
