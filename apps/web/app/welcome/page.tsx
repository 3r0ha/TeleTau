"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CaretRight } from "@phosphor-icons/react/ssr";
import { Illustration, StepHeading, type IllustrationName } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { useRequireAccount } from "@teletau/session/react";
import { BackButton, LoadingBlock, Screen, SignOutAction, SimpleTop, useDocumentTitle } from "../_components/screens";
import { useFlowSteps } from "../_components/steps";
import { DEFAULT_GOAL } from "../_components/learn/GoalPicker";
import { selfApi } from "../_components/learn/self-api";
import { NicknamePicker } from "../student/NicknamePicker";
import { nextTeacherStep } from "../teacher/useTeacher";

type Step = "choose" | "nick";

const TITLES: Record<Step, string> = { choose: "Что дальше?", nick: "Выбери ник" };

function Choice({ href, onClick, art, title, text }: { href?: string; onClick?: () => void; art: IllustrationName; title: string; text: string }) {
  const body = (
    <>
      <Illustration name={art} width={72} className="start-way__art" />
      <span className="start-way__body">
        <b className="start-way__title">{title}</b>
        <span className="start-way__text">{text}</span>
      </span>
      <CaretRight weight="bold" aria-hidden className="start-way__caret" />
    </>
  );
  return href ? (
    <Link href={href} className="start-way">
      {body}
    </Link>
  ) : (
    <button type="button" className="start-way" onClick={onClick}>
      {body}
    </button>
  );
}

/**
 * Взрослый после входа по почте (ADR 0022): «Учиться» — ник для лиги и сразу тропа (цель дня — 2 урока по умолчанию,
 * меняется в профиле, как в «Учусь сам»; прогресс — за этим аккаунтом, вход — по почте); «Я учитель» — условия и заявка
 * на подтверждение. Заявка — только по выбору.
 */
export default function WelcomePage() {
  const router = useRouter();
  const params = useSearchParams();
  const me = useRequireAccount("adult", "/teacher/login");
  const flow = useFlowSteps<Step>("choose");
  const asked = params.get("step");
  // Старый адрес шага цели (?step=goal) ведёт к нику: цель больше не спрашиваем.
  const step: Step = asked === "nick" || asked === "goal" ? "nick" : "choose";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(TITLES[step]);

  // Уже выбрал: учится — на тропу; учитель или заявитель — в кабинет.
  useEffect(() => {
    if (!me) return;
    if (me.teacherStatus !== "none") router.replace(nextTeacherStep(me));
    else if (me.nickname) router.replace("/learn");
  }, [me, router]);

  const learn = async (nicknameId: string) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await selfApi.updateMe({ nicknameId, ageBand: "adult", dailyGoal: DEFAULT_GOAL });
      session.updateAccount(updated);
      router.replace("/learn");
    } catch (e) {
      setError(describeProblem(e, "adult"));
      setBusy(false);
    }
  };

  const start = step === "choose" ? undefined : <BackButton label="Назад" onClick={() => flow.back("choose")} />;

  return (
    <Screen top={<SimpleTop
          start={start}
          // «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1)
          title={<span lang="ba">ТелеТау</span>}
          end={<SignOutAction />}
        />} className="self">
      {!me || me.nickname || me.teacherStatus !== "none" ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="tt-stack tt-stack--loose">
          <header className="self__head">
            <StepHeading focusKey={step}>{TITLES[step]}</StepHeading>
            <Illustration name={step === "nick" ? "beeThink" : "beeFly"} width={84} className="self__bee" />
          </header>
          {step === "choose" ? (
            <nav className="start__ways" aria-label="Что дальше">
              <Choice onClick={() => flow.go("nick")} art="beeRead" title="Учиться" text="Уроки башкирского языка" />
              <Choice href={nextTeacherStep(me)} art="beeTeacher" title="Я учитель" text="Класс, задания, прогресс учеников" />
            </nav>
          ) : (
            <NicknamePicker submitLabel="Начать" submitting={busy} error={error} onPick={(picked) => void learn(picked.id)} />
          )}
        </div>
      )}
    </Screen>
  );
}
