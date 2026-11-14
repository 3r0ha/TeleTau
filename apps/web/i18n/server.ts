// Язык интерфейса на сервере: cookie читает корневой layout (html lang и провайдер), серверные компоненты
// берут переводчик через getT(). next/headers ограничивает файл сервером — в клиентские не импортировать.
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale, type T } from "./core";
import { tFor } from "./registry";

/** Язык из cookie; без cookie или с неизвестным значением — русский. */
export async function getLocale(): Promise<Locale> {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? "ru";
}

/** Переводчик для серверного компонента: const t = await getT(); … t("Продолжить"). */
export async function getT(): Promise<T> {
  return tFor(await getLocale());
}
