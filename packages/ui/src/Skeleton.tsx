import type { ReactNode } from "react";

/** Радиус скелетона — по роли элемента, который он заменяет (токены radius.*). */
export type SkeletonRadius = "tile" | "button" | "panel" | "card";

/**
 * Скелетон-заглушка загрузки. Для читалок — один статус «Загрузка» на группу (см. SkeletonGroup).
 * Размеры — атрибутами SVG (строгая CSP не пропускает атрибуты style).
 */
export function Skeleton({ width = "100%", height = 16, radius = "tile" }: { width?: number | string; height?: number | string; radius?: SkeletonRadius }) {
  return <svg className={`tt-skeleton tt-skeleton--${radius}`} width={width} height={height} aria-hidden focusable="false" />;
}

/** Группа скелетонов: role="status" с подписью, чтобы читалка сообщила о загрузке один раз. */
export function SkeletonGroup({ label = "Загрузка", children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      {children}
    </div>
  );
}
