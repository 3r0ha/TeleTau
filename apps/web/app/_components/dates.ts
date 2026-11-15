// Даты и числа на языке интерфейса. Названия месяцев и дней недели — ключи каталогов переводов (t): в браузерах
// данных Intl для башкирского может не быть, поэтому слова берутся из словарей, а Intl даёт только числа по поясу.
// Строка YYYY-MM-DD — учебные сутки, уже посчитанные сервером по Уфе; момент ISO — переводится в пояс Уфы.
import type { T } from "../../i18n/core";

/** Месяцы в родительном падеже: «9 ноября». */
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** Дни недели, 0 — воскресенье. */
const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEKDAYS_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export const UFA_TZ = "Asia/Yekaterinburg";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const partFormats = new Map<string, Intl.DateTimeFormat>();

function parts(value: string | Date, timeZone: string): Parts {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    return { year, month, day, hour: 12, minute: 0, weekday: new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() };
  }
  const date = typeof value === "string" ? new Date(value) : value;
  let fmt = partFormats.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    partFormats.set(timeZone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  return { year, month, day, hour: Number(p.hour), minute: Number(p.minute), weekday: new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() };
}

/** «9 ноября», с годом — «9 ноября 2026». Момент ISO — по Уфе. */
export function dayMonth(value: string | Date, t: T, opts: { year?: boolean; timeZone?: string } = {}): string {
  const p = parts(value, opts.timeZone ?? UFA_TZ);
  const text = `${p.day} ${t(MONTHS[p.month - 1] ?? "")}`;
  return opts.year ? `${text} ${p.year}` : text;
}

/** «Пн» — короткий день недели. */
export function weekdayShort(value: string | Date, t: T, timeZone: string = UFA_TZ): string {
  return t(WEEKDAYS_SHORT[parts(value, timeZone).weekday] ?? "");
}

/** «понедельник» — день недели полностью. */
export function weekdayLong(value: string | Date, t: T, timeZone: string = UFA_TZ): string {
  return t(WEEKDAYS_LONG[parts(value, timeZone).weekday] ?? "");
}

/** «14:05» по Уфе. */
export function timeOfDay(value: string | Date, timeZone: string = UFA_TZ): string {
  const p = parts(value, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** «07.11» — день и месяц цифрами. */
export function dayMonthDigits(value: string | Date, timeZone: string = UFA_TZ): string {
  const p = parts(value, timeZone);
  return `${String(p.day).padStart(2, "0")}.${String(p.month).padStart(2, "0")}`;
}

/** День месяца числом: «9» — для диапазона «9–15 ноября». */
export function dayOfMonth(value: string | Date, timeZone: string = UFA_TZ): number {
  return parts(value, timeZone).day;
}

/** Месяц (1–12) — сравнить, в одном ли месяце две даты. */
export function monthOf(value: string | Date, timeZone: string = UFA_TZ): number {
  return parts(value, timeZone).month;
}

const counts = new Intl.NumberFormat("ru-RU");

/** Число с разрядами через неразрывный пробел: 12345 → «12 345» (так же в ru, ba и kk). */
export function formatCount(n: number): string {
  return counts.format(n);
}
