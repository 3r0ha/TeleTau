import type { ReactNode } from "react";
import { Check } from "@phosphor-icons/react/ssr";
import { Illustration } from "@teletau/ui";

export type JourneyStep = "login" | "terms" | "apply" | "pending";

const STEPS: { key: JourneyStep; title: string; text?: string }[] = [
  { key: "login", title: "Вход по почте" },
  { key: "terms", title: "Условия" },
  { key: "apply", title: "Заявка" },
  { key: "pending", title: "Проверка", text: "до 1 рабочего дня" },
];

/**
 * Путь учителя до кабинета (вход → условия → заявка → проверка) — сбоку от формы на компьютере: учитель видит, где он и
 * сколько осталось. На телефоне панели нет: у заявки свой индикатор шагов.
 */
export function Journey({ current }: { current: JourneyStep }) {
  const at = STEPS.findIndex((s) => s.key === current);
  return (
    <aside className="journey" aria-labelledby="journey-title">
      <Illustration name="sceneClassHive" width={200} className="journey__art" />
      <h2 id="journey-title" className="journey__title">
        Кабинет учителя
      </h2>
      <ol className="journey__steps">
        {STEPS.map((s, i) => {
          const state = i < at ? "done" : i === at ? "current" : "todo";
          return (
            <li key={s.key} className="journey__step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="journey__mark" aria-hidden>
                {state === "done" ? <Check weight="bold" /> : i + 1}
              </span>
              <span className="journey__body">
                <b>{s.title}</b>
                {s.text ? <span>{s.text}</span> : null}
              </span>
            </li>
          );
        })}
        <li className="journey__step journey__step--goal" data-state="todo">
          <span className="journey__mark" aria-hidden>
            5
          </span>
          <span className="journey__body">
            <b>Первый урок</b>
          </span>
        </li>
      </ol>
    </aside>
  );
}

/** Форма слева, путь учителя справа (на компьютере); на телефоне — только форма. */
export function OnboardLayout({ step, children }: { step: JourneyStep; children: ReactNode }) {
  return (
    <div className="onboard">
      <div className="onboard__main">{children}</div>
      <Journey current={step} />
    </div>
  );
}
