// Даты на языке интерфейса: месяцы и дни недели — из каталогов переводов, числа — по поясу Уфы.
import { describe, expect, it } from "vitest";
import { tFor } from "../i18n/registry";
import { dayMonth, dayMonthDigits, formatCount, timeOfDay, weekdayLong, weekdayShort } from "../app/_components/dates";
import { dueForStudent, dueForTeacher, dueLong } from "../app/_components/assignments";

const ru = tFor("ru");
const ba = tFor("ba");
const kk = tFor("kk");

describe("даты на языке интерфейса", () => {
  it("день и месяц: ru — родительный падеж, ba и kk — из словарей", () => {
    expect(dayMonth("2026-11-09", ru)).toBe("9 ноября");
    expect(dayMonth("2026-11-09", ba)).toBe("9 ноябрь");
    expect(dayMonth("2026-11-09", kk)).toBe("9 қараша");
    expect(dayMonth("2026-01-31", ru, { year: true })).toBe("31 января 2026");
  });

  it("момент ISO — сутки и время по Уфе (UTC+5)", () => {
    expect(dayMonth("2026-11-14T19:30:00Z", ru)).toBe("15 ноября");
    expect(timeOfDay("2026-11-14T19:30:00Z")).toBe("00:30");
    expect(dayMonthDigits("2026-11-07")).toBe("07.11");
  });

  it("дни недели: ru, ba (названия из урока «Дни недели»), kk", () => {
    expect(weekdayShort("2026-11-09", ru)).toBe("Пн");
    expect(weekdayLong("2026-11-13", ru)).toBe("пятница");
    expect(weekdayLong("2026-11-13", ba)).toBe("йома");
    expect(weekdayLong("2026-11-13", kk)).toBe("жұма");
  });

  it("сроки заданий берут язык из переводчика", () => {
    expect(dueForStudent("2026-11-07", "2026-11-04", ru)).toBe("до сб");
    expect(dueForTeacher("2026-11-06", "2026-11-03", ru)).toBe("до пт, 6 ноября");
    expect(dueLong("2026-11-06", ru)).toBe("пятница, 6 ноября");
    expect(dueLong("2026-11-06", kk)).toBe("жұма, 6 қараша");
    expect(dueForStudent("2026-11-20", "2026-11-05", ba)).not.toMatch(/ноября/);
  });

  it("числа — с разрядами", () => {
    expect(formatCount(12345)).toBe("12 345");
  });
});
