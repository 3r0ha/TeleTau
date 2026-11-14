"use client";

import { ChoiceGroup, HoneyComb } from "@teletau/ui";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";

/** Цель дня — 1, 2 или 3 урока (docs/02 §6: «соты» по 5 минут); по умолчанию 2. */
export const GOALS = [1, 2, 3] as const;
export type Goal = (typeof GOALS)[number];
export const DEFAULT_GOAL: Goal = 2;

/** Подписи плиток цели: t применяется при рендере (GoalPicker) — на верхнем уровне модуля перевода нет. */
const goalLabels = (t: T): Record<Goal, { title: string; minutes: string }> => ({
  1: { title: t("1 урок в день"), minutes: t("5 минут") },
  2: { title: t("2 урока в день"), minutes: t("10 минут") },
  3: { title: t("3 урока в день"), minutes: t("15 минут") },
});

export const asGoal = (g: number | undefined): Goal => (GOALS.includes(g as Goal) ? (g as Goal) : DEFAULT_GOAL);
export const goalTitle = (g: number | undefined) => goalLabels((ru) => ru)[asGoal(g)].title;

/** Выбор цели дня плитками; слева — соты: сколько уроков, столько ячеек мёда. */
export function GoalPicker({ value, onChange, legend }: { value: Goal; onChange: (g: Goal) => void; legend?: string }) {
  const t = useT();
  const labels = goalLabels(t);
  return (
    <ChoiceGroup
      legend={legend ?? t("Цель на день")}
      hideLegend
      value={String(value) as `${Goal}`}
      onChange={(v) => onChange(Number(v) as Goal)}
      options={GOALS.map((g) => ({
        value: String(g) as `${Goal}`,
        label: labels[g].title,
        description: labels[g].minutes,
        mark: (
          <span className="goal-pick__comb">
            <HoneyComb total={3} filled={g} />
          </span>
        ),
      }))}
    />
  );
}
