"use client";

import type { Ref } from "react";
import { Scales } from "@phosphor-icons/react/ssr";
import { AnswerOptions, Chip, Illustration, type AnswerOptionItem } from "@teletau/ui";
import { useT } from "../../../i18n/client";
import { useDigitKeys } from "./keys";
import type { DuelChoice } from "./model";

export type { DuelChoice };

export interface DuelProps {
  /** Исходная русская фраза. */
  sourceRu: string;
  /**
   * Два башкирских варианта из человеческих источников (origin = import) в порядке показа: A и B. В уроке — поля
   * `a`, `b` упражнения DuelExercise; у учителя — `variants[0].text`, `variants[1].text` из CorpusDuel.
   */
  a: string;
  b: string;
  value: DuelChoice | null;
  onChange: (choice: DuelChoice) => void;
  /** Голос отдан — выбор больше не меняется. */
  disabled?: boolean;
  /** Клавиши 1–4: A, B, «Оба подходят», «Не знаю». */
  keyboard?: boolean;
  /** Уровень заголовка: h1 — экран урока, h2 — дуэль внутри страницы (раздел учителя «Помогите языку»). */
  headingAs?: "h1" | "h2";
  headingRef?: Ref<HTMLHeadingElement>;
  /** Подпись чипа: ученику — «Помоги языку», учителю — «Помогите языку» (обращение на «вы»). */
  chipLabel?: string;
  /** Сцена «две соты» у заголовка (в уроке). У учителя сцена — в шапке страницы, здесь её нет. */
  art?: boolean;
}

const CHOICES: DuelChoice[] = ["a", "b", "both", "skip"];

/**
 * Дуэль «Помоги языку» (prototype 10-lesson-duel; docs/05 §0): исходная фраза, два варианта и
 * «Оба подходят / Не знаю» — без плашки-объяснения и без чужих голосов (защита от конформизма, docs/03 §4a).
 * Компонент не знает, кто голосует: ученик в уроке (POST /lesson-runs/{runId}/attempts) или учитель в разделе
 * «Помогите языку» (POST /corpus/judgments) — кнопку «Отдать голос» и лист после голоса рисует экран.
 */
export function Duel({ sourceRu, a, b, value, onChange, disabled, keyboard, headingAs: Heading = "h1", headingRef, chipLabel, art = true }: DuelProps) {
  const t = useT();
  useDigitKeys(4, (i) => onChange(CHOICES[i]!), Boolean(keyboard && !disabled));
  const options: AnswerOptionItem<DuelChoice>[] = [
    { value: "a", mark: "A", shortcut: "1", label: a, lang: "ba" },
    { value: "b", mark: "B", shortcut: "2", label: b, lang: "ba" },
    { value: "both", look: "pill", shortcut: "3", label: t("Оба подходят") },
    { value: "skip", look: "pill", shortcut: "4", label: t("Не знаю") },
  ];
  return (
    <div className="duel">
      {art ? <Illustration name="sceneDuel" width={118} className="duel__art" /> : null}
      <Chip tone="violet" icon={<Scales weight="fill" aria-hidden />}>
        {chipLabel ?? t("Помоги языку")}
      </Chip>
      <Heading ref={headingRef} tabIndex={-1} className="task-title tt-step-heading">
        {t("Какой перевод лучше?")}
      </Heading>
      <div className="duel__source">
        <small>{t("По-русски")}</small>
        <p>{sourceRu}</p>
      </div>
      <AnswerOptions label={t("Варианты перевода")} tone="violet" options={options} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
