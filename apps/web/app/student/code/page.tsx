"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { normalizeCodeInput, parseClassCode } from "@teletau/auth-codes";
import { Button, CodeInput, ProgressBar, StepHeading } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { ApiProblem, describeProblem } from "@teletau/session/problem";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";
import { BackButton, BackLink, Screen, SimpleTop, useDocumentTitle } from "../../_components/screens";
import { NicknamePicker } from "../NicknamePicker";
import { useFlowSteps } from "../../_components/steps";
import { saveTicket } from "../ticket";
import { useStudentPaths } from "../../_components/learn/paths";

/** Ошибки ввода кода (parseClassCode) — на языке интерфейса (t доступен только при рендере). */
const codeErrors = (t: T) => ({
  empty: t("Введи код с доски."),
  invalid_character: t("В коде только буквы и цифры."),
  invalid_length: t("В коде 6 символов."),
});

type Step = "code" | "nick";

/** Введённый код — в sessionStorage вкладки: «Назад» с шага ника и перезагрузка его не теряют (код живёт 15 минут). */
const DRAFT_KEY = "tt-class-code-draft";

function loadDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(code: string) {
  try {
    if (code) sessionStorage.setItem(DRAFT_KEY, code);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* приватный режим — код живёт только на этой странице */
  }
}

/**
 * Вход без карточки (ADR 0016 §6): код класса с доски → ник из словаря → заявка учителю.
 * Шаг — в адресе (`?step=nick`): системная кнопка «Назад» возвращает к коду, а не уводит со страницы.
 * Код живёт 15 минут; неверный и устаревший неразличимы (404 class_code_not_found).
 */
export default function ClassCodePage() {
  const router = useRouter();
  const paths = useStudentPaths();
  const params = useSearchParams();
  const flow = useFlowSteps<Step>("code");
  const t = useT();
  const step: Step = params.get("step") === "nick" ? "nick" : "code";
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const restored = useRef(false);

  useDocumentTitle(step === "code" ? t("Код класса") : t("Выбери ник"));

  // Черновик кода — после перезагрузки или возврата «Назад». Шаг ника без годного кода — назад к вводу.
  // Исправление адреса — после монтирования: Next.js подключает свой history.replaceState эффектом корня, позже нашего.
  useEffect(() => {
    let draft = code;
    if (!restored.current) {
      restored.current = true;
      draft = loadDraft();
      if (draft) setCode(draft);
    }
    if (step !== "nick" || parseClassCode(draft).ok) return;
    const t = setTimeout(() => flow.replace("code"));
    return () => clearTimeout(t);
  }, [step, code, flow]);

  const next = (value = code) => {
    const parsed = parseClassCode(value);
    if (!parsed.ok) {
      setCodeError(codeErrors(t)[parsed.error]);
      return;
    }
    setCodeError(null);
    saveDraft(value);
    flow.go("nick");
  };

  return (
    <Screen
      top={
        <SimpleTop
          start={step === "code" ? <BackLink href={paths.login} /> : <BackButton label={t("Назад к коду")} onClick={() => flow.back("code")} />}
          title={t("Вход по коду класса")}
        />
      }
    >
      <div className="tt-stack tt-stack--loose">
        <ProgressBar
          value={step === "code" ? 1 : 2}
          max={2}
          label={t("Шаг входа")}
          valueText={step === "code" ? t("Шаг {n} из {total}", { n: 1, total: 2 }) : t("Шаг {n} из {total}", { n: 2, total: 2 })}
        />

        {/* Один заголовок на оба шага: при смене шага на него переходит фокус (StepHeading). */}
        <header className="tt-stack tt-stack--tight">
          <StepHeading focusKey={step}>{step === "code" ? t("Введи код класса") : t("Выбери ник")}</StepHeading>
          <p className="tt-lead">{step === "code" ? t("Код написан на доске в классе.") : t("По нему учитель узнает тебя.")}</p>
        </header>

        {step === "code" ? (
          <form
            className="tt-stack tt-stack--loose"
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            <CodeInput
              length={6}
              charset="code"
              groupSize={3}
              compact
              label={t("Код класса")}
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeError(null);
              }}
              normalize={normalizeCodeInput}
              error={codeError}
              autoFocus
            />
            <Button type="submit" block disabled={code.length < 6}>
              {t("Дальше")}
            </Button>
          </form>
        ) : (
          <div className="tt-stack tt-stack--loose">
            <NicknamePicker
              submitLabel={t("Отправить заявку")}
              submitting={submitting}
              error={submitError}
              onPick={async (nick) => {
                setSubmitting(true);
                setSubmitError(null);
                try {
                  const ticket = await session.requestClassCode(code, nick.id);
                  saveTicket(ticket, nick.text);
                  saveDraft("");
                  router.replace(paths.wait);
                } catch (e) {
                  setSubmitting(false);
                  if (e instanceof ApiProblem && e.code === "class_code_not_found") {
                    setCodeError(describeProblem(e, "child"));
                    flow.back("code");
                  } else {
                    setSubmitError(describeProblem(e, "child"));
                  }
                }
              }}
            />
          </div>
        )}
      </div>
    </Screen>
  );
}
