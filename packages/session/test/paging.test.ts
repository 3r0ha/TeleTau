// «Показать ещё» не дублирует строки, даже если страница пришла дважды или очередь сдвинулась.
import { describe, expect, it } from "vitest";
import { appendUnique } from "../src/paging";

const row = (id: string, label = id) => ({ id, label });

describe("appendUnique", () => {
  it("добавляет новые элементы в порядке сервера", () => {
    expect(appendUnique([row("a"), row("b")], [row("c"), row("d")]).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("та же страница дважды (двойное нажатие) — без дублей", () => {
    const page = [row("c"), row("d")];
    const once = appendUnique([row("a"), row("b")], page);
    expect(appendUnique(once, page).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("пересечение страниц и повтор внутри страницы — первый экземпляр остаётся", () => {
    const out = appendUnique([row("a", "старый")], [row("a", "новый"), row("b"), row("b")]);
    expect(out).toEqual([row("a", "старый"), row("b")]);
  });

  it("не меняет исходный список", () => {
    const list = [row("a")];
    appendUnique(list, [row("b")]);
    expect(list).toEqual([row("a")]);
  });
});
