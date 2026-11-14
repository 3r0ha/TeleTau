import type { Schema } from "@teletau/contracts";
import { msUntil } from "@teletau/session/clock";
import type { T } from "../../../../i18n/core";

export type ClassDetail = Schema<"ClassDetail">;
export type Seat = Schema<"Seat">;
export type PrintJob = Schema<"PrintJob">;

/** Номер места всегда двузначный: «№07» — так он напечатан на карточке. */
export const seatNo = (n: number) => String(n).padStart(2, "0");
export const seatLabel = (n: number) => `№${seatNo(n)}`;

/** Время показываем по Уфе (учебные сутки — Asia/Yekaterinburg, CLAUDE.md «Соглашения»). */
const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yekaterinburg" });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Yekaterinburg" });
export const time = (iso: string) => timeFmt.format(new Date(iso));
export const date = (iso: string) => dateFmt.format(new Date(iso));

/** Диапазон номеров «№01–№24» или «№07». */
export function seatRange(numbers: number[]): string {
  if (!numbers.length) return "";
  const sorted = [...numbers].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return first === last ? seatLabel(first) : `${seatLabel(first)}–${seatLabel(last)}`;
}

export function cardsWord(n: number, t: T): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return t("карточка");
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t("карточки");
  return t("карточек");
}

/** Имя файла PDF: «teletau-cards-5B.pdf» (без кавычек и пробелов). */
export function pdfName(title: string): string {
  const slug = title.replace(/[«»"'\s]/g, "") || "class";
  return `teletau-cards-${slug}.pdf`;
}

/** Задание печати класса — в sessionStorage вкладки до его срока (секретов в нём нет, только идентификатор). */
const printKey = (classId: string) => `tt-print-${classId}`;

export function savePrintJob(classId: string, job: PrintJob) {
  try {
    sessionStorage.setItem(printKey(classId), JSON.stringify(job));
  } catch {
    /* приватный режим */
  }
}

export function loadPrintJob(classId: string): PrintJob | null {
  try {
    const raw = sessionStorage.getItem(printKey(classId));
    if (!raw) return null;
    const job = JSON.parse(raw) as PrintJob;
    return printJobLive(job) ? job : null;
  } catch {
    return null;
  }
}

/** Задание печати ещё живо — по часам сервера (clock.ts), а не устройства: на школьном ПК часы бывают сбиты. */
export function printJobLive(job: PrintJob | null): job is PrintJob {
  return Boolean(job) && msUntil(job!.expiresAt) > 0;
}

/** Идентификатор класса в адресе — UUID (контракт); иначе страница сразу показывает «Класс не найден». */
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Номера мест отрезками: «№05, №13–№24» — свободные места не обязательно идут подряд. */
export function seatRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(seatRange(sorted.slice(i, j + 1)));
    i = j + 1;
  }
  return parts.join(", ");
}
