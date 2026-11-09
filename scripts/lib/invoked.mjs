import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * true, если модуль запущен напрямую (`node script.mjs`), а не импортирован.
 * Сравниваются реальные пути: устойчиво к пробелам и кириллице в пути и к симлинкам.
 */
export function isInvokedDirectly(metaUrl) {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
