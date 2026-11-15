"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CaretRight } from "@phosphor-icons/react/ssr";
import { Illustration, StepHeading, buttonClass, type IllustrationName } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { useRequireAccount } from "@teletau/session/react";
import { useT } from "../../i18n/client";
import { BackButton, LoadingBlock, Screen, SignOutAction, SimpleTop, useDocumentTitle } from "../_components/screens";
import { useFlowSteps } from "../_components/steps";
import { DEFAULT_GOAL } from "../_components/learn/GoalPicker";
import { selfApi } from "../_components/learn/self-api";
import { useStudentPaths } from "../_components/learn/paths";
import { NicknamePicker } from "../student/NicknamePicker";
import { nextTeacherStep } from "../_components/home";

type Step = "choose" | "nick";

/** Пункт выбора: ссылка, кнопка или (external) адрес сайта в новом окне — из Mini App кабинет учителя открывается браузером. */
function Choice({
  href,
  external,
  onClick,
  art,
  title,
  text,
}: {
  href?: string;
  external?: boolean;
  onClick?: () => void;
  art: IllustrationName;
  title: string;
  text: string;
}) {
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
  if (href && external)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="start-way">
        {body}
      </a>
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
 * на подтверждение. Заявка — только по выбору. Кабинет учителя есть только на сайте: в Mini App он открывается в браузере,
 * а экран остаётся под /miniapp.
 */
export default function WelcomePage() {
  const router = useRouter();
  const params = useSearchParams();
  const paths = useStudentPaths();
  const me = useRequireAccount("adult", paths.loginEmail);
  const flow = useFlowSteps<Step>("choose");
  const t = useT();
  // Заголовки шагов на языке интерфейса: t доступен только при рендере, поэтому словарь — внутри компонента.
  const titles: Record<Step, string> = { choose: t("Что дальше?"), nick: t("Выбери ник") };
  const asked = params.get("step");
  // Адрес шага цели (?step=goal) ведёт к нику.
  const step: Step = asked === "nick" || asked === "goal" ? "nick" : "choose";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inMiniApp = paths.prefix !== "";
  const teacherOutside = Boolean(me && inMiniApp && me.teacherStatus !== "none");
  useDocumentTitle(teacherOutside ? t("Кабинет учителя") : titles[step]);

  // Уже выбрал: учится — на тропу; учитель или заявитель — в кабинет (из Mini App — ссылкой на сайт, без перехода).
  useEffect(() => {
    if (!me) return;
    if (me.teacherStatus !== "none") {
      if (!inMiniApp) router.replace(nextTeacherStep(me));
    } else if (me.nickname) router.replace(paths.learn);
  }, [me, router, paths.learn, inMiniApp]);

  const learn = async (nicknameId: string) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await selfApi.updateMe({ nicknameId, ageBand: "adult", dailyGoal: DEFAULT_GOAL });
      session.updateAccount(updated);
      router.replace(paths.learn);
    } catch (e) {
      setError(describeProblem(e, "adult", t));
      setBusy(false);
    }
  };

  const start = step === "choose" ? undefined : <BackButton label={t("Назад")} onClick={() => flow.back("choose")} />;

  return (
    <Screen top={<SimpleTop
          start={start}
          // «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1)
          title={<span lang="ba">ТелеТау</span>}
          // Из Mini App — на вход Mini App: его тропа после выхода ждёт сессию, а вход доступен сразу.
          end={<SignOutAction to={inMiniApp ? paths.login : paths.start} />}
        />} className="self">
      {me && teacherOutside ? (
        <div className="tt-stack tt-stack--loose">
          <header className="self__head">
            <StepHeading focusKey="teacher">{t("Кабинет учителя")}</StepHeading>
            <Illustration name="beeTeacher" width={84} className="self__bee" />
          </header>
          <a href={nextTeacherStep(me)} target="_blank" rel="noopener noreferrer" className={buttonClass({ block: true })}>
            {t("Открыть в браузере")}
          </a>
        </div>
      ) : !me || me.nickname || me.teacherStatus !== "none" ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="tt-stack tt-stack--loose">
          <header className="self__head">
            <StepHeading focusKey={step}>{titles[step]}</StepHeading>
            <Illustration name={step === "nick" ? "beeThink" : "beeFly"} width={84} className="self__bee" />
          </header>
          {step === "choose" ? (
            <nav className="start__ways" aria-label={t("Что дальше")}>
              <Choice onClick={() => flow.go("nick")} art="beeRead" title={t("Учиться")} text={t("Уроки башкирского языка")} />
              <Choice href={nextTeacherStep(me)} external={inMiniApp} art="beeTeacher" title={t("Я учитель")} text={t("Класс, задания, прогресс учеников")} />
            </nav>
          ) : (
            <NicknamePicker submitLabel={t("Начать")} submitting={busy} error={error} onPick={(picked) => void learn(picked.id)} />
          )}
        </div>
      )}
    </Screen>
  );
}
