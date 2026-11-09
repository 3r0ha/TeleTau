// Разметка компонентов на сервере (как её отдаёт Next.js): без атрибутов style (строгая CSP), выбранная плитка
// с галочкой, шаговый заголовок фокусируемый.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinkButton } from "../src/Button";
import { ChoiceGroup } from "../src/ChoiceGroup";
import { CodeInput } from "../src/CodeInput";
import { HexAvatar } from "../src/HexAvatar";
import { ProgressBar } from "../src/ProgressBar";
import { Skeleton } from "../src/Skeleton";
import { StepHeading } from "../src/StepHeading";
import { AnswerOptions } from "../src/AnswerOption";
import { HexNode } from "../src/HexNode";
import { HoneyComb } from "../src/HoneyComb";
import { LeagueRow } from "../src/LeagueRow";
import { BASHKIR_LETTERS, LetterPanel } from "../src/LetterPanel";
import { WordTile } from "../src/WordTile";

const noop = () => undefined;

describe("серверная разметка компонентов", () => {
  it("HexAvatar, ProgressBar, Skeleton и CodeInput — без атрибутов style", () => {
    const html = renderToStaticMarkup(
      <>
        <HexAvatar size={64} tone="green" lip ring>
          07
        </HexAvatar>
        <ProgressBar value={2} max={3} label="Шаг" valueText="Шаг 2 из 3" showValue />
        <Skeleton width="60%" height={30} radius="card" />
        <CodeInput length={6} value="K7Q" onChange={noop} label="Код класса" error="Ошибка" hint="Подсказка" />
      </>,
    );
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain('width="66.67%"');
    expect(html).toContain('class="tt-skeleton tt-skeleton--card" width="60%" height="30"');
    expect(html).toMatch(/<text class="tt-hex__text"[^>]*>07<\/text>/);
  });

  it("у выбранной плитки есть значок-галочка; выбор передан и радиокнопкой (не только цветом)", () => {
    const html = renderToStaticMarkup(
      <ChoiceGroup legend="Класс" layout="inline" value="5" onChange={noop} options={["4", "5", "6"].map((g) => ({ value: g, label: g }))} />,
    );
    expect(html.match(/class="tt-choice__check"/g)).toHaveLength(3);
    expect(html).toMatch(/checked="" value="5"/);
  });

  it("LinkButton в загрузке («Показать ещё», M1-50): aria-busy и aria-disabled, индикатор, но не disabled — фокус остаётся", () => {
    const busy = renderToStaticMarkup(
      <LinkButton loading onClick={noop}>
        Показать ещё
      </LinkButton>,
    );
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-disabled="true"');
    expect(busy).toContain("tt-spin");
    expect(busy).not.toMatch(/\sdisabled=""/);
    const idle = renderToStaticMarkup(<LinkButton onClick={noop}>Показать ещё</LinkButton>);
    expect(idle).not.toContain("aria-busy");
    expect(idle).not.toContain("aria-disabled");
  });

  it("StepHeading — h1 с tabIndex=-1: на него переносится фокус при смене шага", () => {
    const html = renderToStaticMarkup(<StepHeading focusKey="nick">Выбери ник</StepHeading>);
    expect(html).toBe('<h1 tabindex="-1" class="tt-title2 tt-step-heading">Выбери ник</h1>');
  });
});

describe("примитивы M2: тропа, урок, мотивация", () => {
  it("узел тропы: закрытый — картинка с подписью, текущий — кнопка с кольцом; без атрибутов style", () => {
    const html = renderToStaticMarkup(
      <>
        <HexNode state="locked" icon={<i />} label="Урок «Мой дом», закрыт" />
        <HexNode state="current" icon={<i />} label="Урок «Моя школа» — начать" progress={0.6} onClick={noop} />
        <HexNode state="done" tone="violet" icon={<i />} label="Помоги языку, пройден" onClick={noop} />
      </>,
    );
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain('<span class="tt-node tt-node--locked" role="img" aria-label="Урок «Мой дом», закрыт">');
    expect(html).toMatch(/<button type="button" class="tt-node tt-node--honey tt-node--current" aria-label="Урок «Моя школа» — начать">/);
    expect(html).toContain('stroke-dasharray="60 100"');
    expect(html).toContain("tt-node--violet");
  });

  it("панель букв — девять особых букв правильными кодовыми точками, lang=ba", () => {
    expect(BASHKIR_LETTERS.map((l) => l.codePointAt(0)!.toString(16))).toEqual(["4d9", "4e9", "4af", "493", "4a1", "4a3", "499", "4ab", "4bb"]);
    const html = renderToStaticMarkup(<LetterPanel onInsert={noop} />);
    expect(html.match(/<button type="button" class="tt-letter" lang="ba">/g)).toHaveLength(9);
    expect(html).toContain('role="group" aria-label="Башкирские буквы"');
  });

  it("варианты ответа — радиогруппа: выбранный aria-checked, клавиша-подсказка, фокус только на выбранном", () => {
    const html = renderToStaticMarkup(
      <AnswerOptions
        label="Варианты"
        value="b"
        onChange={noop}
        options={[
          { value: "a", mark: "1", label: "Привет!" },
          { value: "b", mark: "2", label: "Спасибо" },
          { value: "skip", look: "pill", shortcut: "4", label: "Не знаю" },
        ]}
      />,
    );
    expect(html).toContain('role="radiogroup" aria-label="Варианты"');
    expect(html).toMatch(/role="radio" aria-checked="true" aria-keyshortcuts="2" tabindex="0"/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(html).toContain('class="tt-pill tt-option--honey"');
  });

  it("плитка в банке после выбора — «след» без кнопки, скрытый от читалок; соты и строка лиги без style", () => {
    const html = renderToStaticMarkup(
      <>
        <WordTile used>мәктәпкә</WordTile>
        <HoneyComb total={12} filled={7} nectar={5} label="7 созрели, 5 ждут" />
        <ol>
          <LeagueRow rank={5} nickname="Смелая пчела" points={318} me zone="up" />
        </ol>
      </>,
    );
    expect(html).toContain('<span class="tt-tile tt-tile--used" aria-hidden="true" lang="ba">мәктәпкә</span>');
    expect(html.match(/tt-comb__cell--honey/g)).toHaveLength(7);
    expect(html.match(/tt-comb__cell--nectar/g)).toHaveLength(5);
    expect(html).toContain('aria-current="true"');
    expect(html).not.toMatch(/\sstyle="/);
  });
});
