// Строки компонентов на языке приложения: без провайдера — русские, с провайдером — переводы тех же русских строк.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalMeter } from "../src/GoalMeter";
import { LeagueRow } from "../src/LeagueRow";
import { SkeletonGroup } from "../src/Skeleton";
import { StudentTabBar } from "../src/StudentTabBar";
import { RU_UI_STRINGS, fillUi, uiStringsFrom } from "../src/strings";
import { UiStringsProvider } from "../src/UiStrings";

const hrefs = { path: "/learn", league: "/league", hive: "/hive", me: "/me" };
const wrap = (ru: string) => `[ba ${ru}]`;

describe("строки packages/ui", () => {
  it("без провайдера — русские подписи", () => {
    const html = renderToStaticMarkup(<StudentTabBar current="path" hrefs={hrefs} />);
    for (const label of ["Путь", "Лига", "Класс", "Профиль"]) expect(html).toContain(label);
    expect(html).toContain('aria-label="Разделы"');
  });

  it("с провайдером — переводы: вкладки, цель дня, строка лиги, подпись загрузки", () => {
    const html = renderToStaticMarkup(
      <UiStringsProvider strings={uiStringsFrom(wrap)}>
        <StudentTabBar current="league" hrefs={hrefs} />
        <GoalMeter done={1} target={2} />
        <ol>
          <LeagueRow rank={3} nickname="Смелая пчела" points={12} me zone="up" />
        </ol>
        <SkeletonGroup>
          <span />
        </SkeletonGroup>
      </UiStringsProvider>,
    );
    for (const text of ["[ba Путь]", "[ba Профиль]", "[ba Цель дня: 1 из 2]", "[ba 1 из 2]", "[ba сот]", "[ba Место 3]", "[ba ты]", "[ba 12 мёда]", "[ba зона повышения]"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('aria-label="[ba Разделы]"');
    expect(html).toContain('aria-label="[ba Загрузка]"');
    expect(html).not.toMatch(/>(Путь|Профиль|ты|сот)</);
  });

  it("fillUi подставляет значения, неизвестные оставляет", () => {
    expect(fillUi(RU_UI_STRINGS.codeCell, { label: "Код", n: 2, length: 6 })).toBe("Код: символ 2 из 6");
    expect(fillUi("{a} и {b}", { a: 1 })).toBe("1 и {b}");
  });
});
