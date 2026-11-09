import { useId } from "react";
import { illustrations, type IllustrationName } from "./illustrations";

export interface GlintBadgeProps {
  name: IllustrationName;
  width: number;
  /** Подпись для читалок; без неё значок декоративный. */
  alt?: string;
  /** Значок поднимается снизу с пружиной перед бликом (экран «Новая лига»). */
  rise?: boolean;
  className?: string;
}

/**
 * Значок с бликом (лига): по картинке проходит светлая полоса. Полоса обрезана маской по альфа-каналу самой картинки,
 * поэтому блестит только значок, а не прозрачный фон вокруг. Всё — SVG с атрибутами (строгая CSP), движение — CSS
 * (токены rise, glint, spring); при «Уменьшении движения» блика и подъёма нет.
 */
export function GlintBadge({ name, width, alt, rise, className }: GlintBadgeProps) {
  const raw = useId();
  const mask = `glint-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const img = illustrations[name];
  const height = Math.round((img.height / img.width) * width);
  return (
    <svg
      className={["tt-glint", rise && "tt-glint--rise", className].filter(Boolean).join(" ")}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      focusable="false"
    >
      <defs>
        <mask id={mask} className="tt-glint__mask" maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <image href={img.src} width={width} height={height} />
        </mask>
      </defs>
      <image href={img.src} width={width} height={height} />
      <g mask={`url(#${mask})`}>
        <rect className="tt-glint__band" x={-width * 0.55} y={-height * 0.2} width={width * 0.32} height={height * 1.4} />
      </g>
    </svg>
  );
}
