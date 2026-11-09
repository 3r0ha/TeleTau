"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Schema } from "@teletau/contracts";
import { Button, ChoiceGroup, Illustration, ProgressBar, StepHeading } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { BackButton, BackLink, Screen, SimpleTop, useDocumentTitle } from "../_components/screens";
import { useFlowSteps } from "../_components/steps";
import { useStudentPaths } from "../_components/learn/paths";
import { NicknamePicker } from "../student/NicknamePicker";

type AgeBand = Schema<"AgeBand">;
type Step = "age" | "nick";
const STEPS: Step[] = ["age", "nick"];

const AGES: { value: AgeBand; label: string }[] = [
  { value: "age_7_10", label: "7–10 лет" },
  { value: "age_11_14", label: "11–14 лет" },
  { value: "age_15_17", label: "15–17 лет" },
  { value: "adult", label: "18 и старше" },
];

const TITLES: Record<Step, string> = { age: "Сколько тебе лет?", nick: "Выбери ник" };

/**
 * «Учусь сам» (ADR 0022): возраст диапазоном → ник из словаря → сразу тропа. Цель дня — 2 урока по умолчанию, меняется
 * в профиле (шаг цели убран из знакомства ради короткого старта, docs/plans/M2-copy-student.md). Ничего личного: ни
 * имени, ни почты, ни телефона. Шаг — в адресе (`?step=…`, как вход по коду класса): системная «Назад» возвращает на
 * предыдущий шаг. Выбранное живёт только на этой странице; после перезагрузки — с первого шага.
 */
export default function SelfStartPage() {
  const router = useRouter();
  const paths = useStudentPaths();
  const params = useSearchParams();
  const flow = useFlowSteps<Step>("age");
  const step: Step = params.get("step") === "nick" ? "nick" : "age";
  const [age, setAge] = useState<AgeBand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(TITLES[step]);

  // Шаг ника без выбранного возраста (перезагрузка, ссылка) — к выбору возраста.
  useEffect(() => {
    if (age || step === "age") return;
    const t = setTimeout(() => flow.replace("age"));
    return () => clearTimeout(t);
  }, [age, step, flow]);

  const start = async (nicknameId: string) => {
    if (!age) return;
    setBusy(true);
    setError(null);
    try {
      await session.startSelf({ nicknameId, ageBand: age });
      router.replace(paths.learn);
    } catch (e) {
      setError(describeProblem(e, "child"));
      setBusy(false);
    }
  };

  const index = STEPS.indexOf(step);
  const back = step === "age" ? <BackLink href={paths.start} /> : <BackButton label="Назад" onClick={() => flow.back("age")} />;

  return (
    <Screen top={<SimpleTop start={back} title="Учусь сам" />} className="self">
      <ProgressBar value={index + 1} max={STEPS.length} label="Шаг" valueText={`Шаг ${index + 1} из ${STEPS.length}`} />
      <div className="self__step tt-stack tt-stack--loose">
        <header className="self__head">
          <StepHeading focusKey={step}>{TITLES[step]}</StepHeading>
          <Illustration name={step === "nick" ? "beeThink" : "beeRead"} width={84} className="self__bee" />
        </header>

        {step === "age" ? (
          <div className="tt-stack tt-stack--loose">
            <ChoiceGroup legend="Сколько тебе лет?" hideLegend value={age} onChange={setAge} options={AGES} />
            <Button block disabled={!age} onClick={() => flow.go("nick")}>
              Дальше
            </Button>
          </div>
        ) : (
          <div className="tt-stack tt-stack--loose">
            <NicknamePicker submitLabel="Начать" submitting={busy} error={error} onPick={(picked) => void start(picked.id)} />
          </div>
        )}
      </div>
    </Screen>
  );
}
