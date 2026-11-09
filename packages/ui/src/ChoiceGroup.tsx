"use client";

import { useId, type ReactNode } from "react";
import { Check } from "@phosphor-icons/react/ssr";

export interface Choice<V extends string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  /** Слева в плитке: номер варианта, аватар. */
  mark?: ReactNode;
  disabled?: boolean;
  /** lang для текста варианта (башкирский — "ba"). */
  lang?: string;
}

export interface ChoiceGroupProps<V extends string> {
  legend: ReactNode;
  /** Скрыть подпись визуально (останется для читалок). */
  hideLegend?: boolean;
  name?: string;
  value: V | null;
  onChange: (value: V) => void;
  options: Choice<V>[];
  /** inline — сетка коротких плиток (номер класса); list — варианты один под другим (prototype .option). */
  layout?: "list" | "inline";
}

/**
 * Выбор одного варианта: настоящие радиокнопки (стрелки, Tab, читалки) в виде плиток с «губой».
 * Выбранная плитка отличается не только цветом: тёмная граница (≥ 3:1 к фону и к заливке) и значок-галочка
 * (WCAG 1.4.1, 1.4.11; пары — packages/design-tokens/tokens/contrast-pairs.json).
 */
export function ChoiceGroup<V extends string>({ legend, hideLegend, name, value, onChange, options, layout = "list" }: ChoiceGroupProps<V>) {
  const auto = useId();
  const groupName = name ?? `choice${auto}`;
  return (
    <fieldset className={["tt-choices", layout === "inline" && "tt-choices--inline"].filter(Boolean).join(" ")}>
      <legend className={hideLegend ? "tt-visually-hidden" : undefined}>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="tt-choice">
          <input
            type="radio"
            name={groupName}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          <span className="tt-choice__box">
            {o.mark}
            <span className="tt-choice__text" lang={o.lang}>
              {o.label}
              {o.description ? <span className="tt-choice__desc">{o.description}</span> : null}
            </span>
            <span className="tt-choice__check" aria-hidden>
              <Check weight="bold" />
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
