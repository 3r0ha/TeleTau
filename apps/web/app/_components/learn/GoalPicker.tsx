"use client";

import { ChoiceGroup, HoneyComb } from "@teletau/ui";

/** Цель дня — 1, 2 или 3 урока (docs/02 §6: «соты» по 5 минут); по умолчанию 2. */
export const GOALS = [1, 2, 3] as const;
export type Goal = (typeof GOALS)[number];
export const DEFAULT_GOAL: Goal = 2;

const LABELS: Record<Goal, { title: string; minutes: string }> = {
  1: { title: "1 урок в день", minutes: "5 минут" },
  2: { title: "2 урока в день", minutes: "10 минут" },
  3: { title: "3 урока в день", minutes: "15 минут" },
};

export const asGoal = (g: number | undefined): Goal => (GOALS.includes(g as Goal) ? (g as Goal) : DEFAULT_GOAL);
export const goalTitle = (g: number | undefined) => LABELS[asGoal(g)].title;

/** Выбор цели дня плитками; слева — соты: сколько уроков, столько ячеек мёда. */
export function GoalPicker({ value, onChange, legend = "Цель на день" }: { value: Goal; onChange: (g: Goal) => void; legend?: string }) {
  return (
    <ChoiceGroup
      legend={legend}
      hideLegend
      value={String(value) as `${Goal}`}
      onChange={(v) => onChange(Number(v) as Goal)}
      options={GOALS.map((g) => ({
        value: String(g) as `${Goal}`,
        label: LABELS[g].title,
        description: LABELS[g].minutes,
        mark: (
          <span className="goal-pick__comb">
            <HoneyComb total={3} filled={g} />
          </span>
        ),
      }))}
    />
  );
}
