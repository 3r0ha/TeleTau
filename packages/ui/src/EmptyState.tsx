import type { ElementType, ReactNode } from "react";
import { illustrations, type IllustrationName } from "./illustrations";

export interface EmptyStateProps {
  /** Иллюстрация из утверждённой серии. */
  art: IllustrationName;
  /** Альтернативный текст картинки; по умолчанию картинка декоративная (смысл несёт заголовок). */
  artAlt?: string;
  title: ReactNode;
  children?: ReactNode;
  /** Одно главное действие и, при необходимости, второстепенное. */
  actions?: ReactNode;
  /** h1 — состояние занимает весь экран; h2 — внутри страницы. */
  headingAs?: ElementType;
  compact?: boolean;
  /** role="alert" для ошибок, которые появились в ответ на действие. */
  role?: "alert" | "status";
}

/** Пустое состояние / ошибка / офлайн (prototype .full): иллюстрация, заголовок, короткий текст, следующий шаг. */
export function EmptyState({ art, artAlt = "", title, children, actions, headingAs: Heading = "h1", compact, role }: EmptyStateProps) {
  const img = illustrations[art];
  return (
    <section className={["tt-empty", compact && "tt-empty--compact"].filter(Boolean).join(" ")} role={role}>
      <img className="tt-empty__art" src={img.src} width={img.width} height={img.height} alt={artAlt} />
      <Heading className="tt-empty__title">{title}</Heading>
      {children ? <div className="tt-empty__text">{children}</div> : null}
      {actions ? <div className="tt-empty__actions">{actions}</div> : null}
    </section>
  );
}

/** Картинка из серии с явными размерами (без сдвига раскладки). */
export function Illustration({ name, alt = "", width, className }: { name: IllustrationName; alt?: string; width: number; className?: string }) {
  const img = illustrations[name];
  return <img className={className} src={img.src} width={width} height={Math.round((img.height / img.width) * width)} alt={alt} />;
}
