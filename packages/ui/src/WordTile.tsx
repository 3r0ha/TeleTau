import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface WordTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /**
   * Плитка уже в ответе: в банке остаётся «след» той же ширины (воск без текста), чтобы банк не прыгал.
   * След не нажимается и скрыт от читалок.
   */
  used?: boolean;
  /** Плитка только что легла в ответ — короткое «появление». */
  pop?: boolean;
}

/**
 * Плитка слова (prototype .tile): белая, граница и «губа» 3 px, радиус плитки. Башкирские слова — lang="ba" по умолчанию.
 */
export function WordTile({ children, used, pop, lang = "ba", className, type = "button", ...rest }: WordTileProps) {
  if (used) {
    return (
      <span className={["tt-tile", "tt-tile--used", className].filter(Boolean).join(" ")} aria-hidden lang={lang}>
        {children}
      </span>
    );
  }
  return (
    <button {...rest} type={type} lang={lang} className={["tt-tile", pop && "tt-tile--pop", className].filter(Boolean).join(" ")}>
      {children}
    </button>
  );
}
