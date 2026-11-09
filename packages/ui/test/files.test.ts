import { describe, expect, it } from "vitest";
import { csvCell, csvTable } from "../src/files";

describe("files — CSV для Excel", () => {
  it("ячейки: кавычки при «;», кавычках и переводах строк; формулы не исполняются", () => {
    expect(csvCell("Смелая пчела")).toBe("Смелая пчела");
    expect(csvCell("а;б")).toBe('"а;б"');
    expect(csvCell('5 "Б"')).toBe('"5 ""Б"""');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(12)).toBe("12");
  });

  it("таблица: BOM, «;», CRLF", () => {
    expect(csvTable([["Исходник", "Вариант"], ["Синтетика", "Буквы ҡ ң ҙ"]])).toBe("\uFEFFИсходник;Вариант\r\nСинтетика;Буквы ҡ ң ҙ\r\n");
  });
});
