// Разметка «живых» компонентов на сервере: без атрибутов style (строгая CSP), декоративное — aria-hidden, а
// движение на сервере выключено (как при «Уменьшении движения»): итоговые значения сразу, конфетти нет.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// В тестах картинка — строка пути; компонентам нужны размеры StaticImageData. Кадры моргания и крыльев — как будто
// они уже есть (реестр beeFrames).
vi.mock("../src/illustrations", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/illustrations")>();
  const img = (name: string) => ({ src: `/${name}.webp`, width: 100, height: 120 });
  return {
    ...real,
    illustrations: new Proxy({}, { get: (_, name) => img(String(name)) }),
    beeFrames: { beeIdle: { blink: "beeIdleBlink", wings: "beeIdleWings" } },
  };
});

const { Bee, SvgBee } = await import("../src/Bee");
const { GlintBadge } = await import("../src/GlintBadge");
const { HexAvatar } = await import("../src/HexAvatar");
const { HoneyConfetti } = await import("../src/HoneyConfetti");
const { FeedbackSheet } = await import("../src/FeedbackSheet");
const { useCountUp } = await import("../src/motion");

const noop = () => undefined;

describe("пчела с кадрами (Bee)", () => {
  it("без дополнительных кадров — одна картинка, как обычная иллюстрация", () => {
    const html = renderToStaticMarkup(<Bee frame="beeThink" width={104} className="prompt__bee" float />);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain('class="tt-bee tt-bee--float prompt__bee"');
    expect(html).toContain('src="/beeThink.webp" width="104" height="125" alt=""');
  });

  it("кадры моргания и крыльев из реестра — поверх основного, декоративные", () => {
    const html = renderToStaticMarkup(<Bee frame="beeIdle" width={100} alt="Пчела" />);
    expect(html.match(/<img/g)).toHaveLength(3);
    expect(html).toContain('class="tt-bee__base" src="/beeIdle.webp"');
    expect(html).toMatch(/class="tt-bee__frame tt-bee__frame--blink" src="\/beeIdleBlink\.webp"[^>]*alt="" aria-hidden="true"/);
    expect(html).toMatch(/class="tt-bee__frame tt-bee__frame--wings" src="\/beeIdleWings\.webp"/);
    // На сервере кадры не переключаются.
    expect(html).not.toContain("data-blink");
  });

  it("явные кадры важнее реестра; SvgBee — те же кадры картинками SVG с атрибутами позиции", () => {
    const html = renderToStaticMarkup(
      <svg>
        <SvgBee frame="beeFly" blink="beeSleep" x={10} y={20} width={92} float />
      </svg>,
    );
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain('<g class="tt-bee tt-bee--float">');
    expect(html).toContain('href="/beeSleep.webp" x="10" y="20" width="92" height="110"');
    expect(html).not.toContain("tt-bee__frame--wings");
  });
});

describe("аватар ника в рамке (HexAvatar art)", () => {
  const art = { src: "/avatar-bee.webp", width: 353, height: 512 };

  it("персонаж обрезан по шестиугольнику, номер места — плашкой, без style", () => {
    const html = renderToStaticMarkup(
      <HexAvatar size={48} tone="green" art={art} lip>
        07
      </HexAvatar>,
    );
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain("tt-hex tt-hex--art tt-hex--green");
    expect(html).toMatch(/<clipPath id="hexava-[^"]+"><path d="M/);
    expect(html).toMatch(/<image href="\/avatar-bee\.webp"[^>]*preserveAspectRatio="xMidYMax meet" clip-path="url\(#hexava-/);
    expect(html).toMatch(/<g class="tt-hex__badge"><rect[^>]*><\/rect><text[^>]*>07<\/text><\/g>/);
  });

  it("без аватара — прежняя цветная ячейка с номером", () => {
    const html = renderToStaticMarkup(<HexAvatar size={48} tone="green" lip>07</HexAvatar>);
    expect(html).not.toContain("tt-hex--art");
    expect(html).toMatch(/<text class="tt-hex__text"[^>]*>07<\/text>/);
  });
});

describe("движение на сервере выключено", () => {
  it("значок с бликом: маска по альфа-каналу, подпись для читалок, без style", () => {
    const html = renderToStaticMarkup(<GlintBadge name="badgeFireweed" width={96} alt="Значок Лиги Кипрея" rise />);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain('class="tt-glint tt-glint--rise"');
    expect(html).toContain('role="img" aria-label="Значок Лиги Кипрея"');
    expect(html).toMatch(/<mask id="glint-[^"]+" class="tt-glint__mask" maskUnits="userSpaceOnUse"/);
    expect(html).toMatch(/<g mask="url\(#glint-[^"]+\)"><rect class="tt-glint__band"/);
  });

  it("конфетти на сервере (и при «Уменьшении движения») не рисуются; счётчик мёда — сразу итог", () => {
    expect(renderToStaticMarkup(<HoneyConfetti />)).toBe("");
    function Honey() {
      return <b>+{useCountUp(16)}</b>;
    }
    expect(renderToStaticMarkup(<Honey />)).toBe("<b>+16</b>");
  });

  it("«Верно» — брызги мёда за галочкой (декоративные), у «Пока не так» их нет", () => {
    const ok = renderToStaticMarkup(<FeedbackSheet tone="ok" title="Верно!" actionLabel="Дальше" onAction={noop} />);
    expect(ok).not.toMatch(/\sstyle="/);
    expect(ok.match(/tt-burst__drop--\d/g)).toHaveLength(6);
    expect(ok).toMatch(/<span class="tt-sheet__mark" aria-hidden="true">/);
    const bad = renderToStaticMarkup(<FeedbackSheet tone="bad" title="Пока не так" actionLabel="Понятно" onAction={noop} />);
    expect(bad).not.toContain("tt-burst");
  });
});
