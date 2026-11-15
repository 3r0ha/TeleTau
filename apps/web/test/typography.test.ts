import { describe, expect, it } from "vitest";
import { keepTogether } from "../app/_components/typography";

const N = " ";

describe("keepTogether", () => {
  it("тире не начинает строку, короткие слова держатся за следующее", () => {
    expect(keepTogether("На каждом месте — новая тема и новые слова.")).toBe(`На${N}каждом месте${N}— новая тема и${N}новые слова.`);
    expect(keepTogether("С классом проходите общий квест.")).toBe(`С${N}классом проходите общий квест.`);
    expect(keepTogether("и в лес")).toBe(`и${N}в${N}лес`);
  });

  it("башкирские буквы — тоже буквы", () => {
    expect(keepTogether("Һәр урында — яңы тема")).toBe(`Һәр урында${N}— яңы тема`);
    expect(keepTogether("ул һәм")).toBe(`ул${N}һәм`);
  });
});
