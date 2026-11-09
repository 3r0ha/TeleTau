import type { ElementType, HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Отступы 24 вместо 16. */
  roomy?: boolean;
  /** Без внутренних отступов (списки во всю ширину карточки). */
  flush?: boolean;
}

/** Карточка: белая поверхность, граница 2 px, радиус 24 (роль «карточка»). */
export function Card({ as: Tag = "div", roomy, flush, className, ...rest }: CardProps) {
  return <Tag {...rest} className={["tt-card", roomy && "tt-card--roomy", flush && "tt-card--flush", className].filter(Boolean).join(" ")} />;
}

export function CardTitle({ as: Tag = "h2", children, id }: { as?: ElementType; children: ReactNode; id?: string }) {
  return (
    <Tag className="tt-card__title" id={id}>
      {children}
    </Tag>
  );
}

export function CardSub({ children }: { children: ReactNode }) {
  return <p className="tt-card__sub">{children}</p>;
}
