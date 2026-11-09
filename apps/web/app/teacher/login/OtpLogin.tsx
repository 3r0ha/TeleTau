"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Card, CodeInput, Form, InlineAlert, LinkButton, TextField, useInvalidFocus } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { ApiProblem, describeProblem, fieldErrors } from "@teletau/session/problem";
import { Screen, SimpleTop, useDocumentTitle } from "../../_components/screens";
import { homeOf } from "../../_components/home";
import { OnboardLayout } from "../Journey";
import { nextTeacherStep } from "../useTeacher";

type Challenge = Schema<"OtpChallenge">;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** Вход взрослого: e-mail → код (в демо-режиме — фиксированный) → выбор «Учиться / Я учитель» или дальше по этапам. */
export function OtpLogin({ demoCode, teacherIntent = false }: { demoCode: string | null; teacherIntent?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  // Сбой сервера или сети — не ошибка поля: сообщение role="alert", поле без aria-invalid, фокус не уводится.
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState(false);
  const wait = useCountdown(resendAt);
  const invalid = useInvalidFocus();
  // У шага ввода кода — свой заголовок вкладки, как у шагов заявки и кода класса.
  useDocumentTitle(challenge ? "Введите код" : "Вход для учителя");

  const requestCode = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Проверьте адрес почты");
      invalid.request();
      return;
    }
    setBusy(true);
    setEmailError(null);
    setFormError(null);
    try {
      const c = await unwrap(api.POST("/api/v1/auth/otp/request", { body: { email: email.trim() } }));
      setChallenge(c);
      setResendAt(Date.now() + c.resendAfterSeconds * 1000);
      setCode("");
      setCodeError(null);
    } catch (e) {
      // Адрес отклонил сервер (422 /email) — ошибка у поля и фокус на нём. Остальное (сбой, сеть, лимит) и повторная
      // отправка с шага кода, где поля почты нет, — сообщением: введённое верно.
      const emailProblem = fieldErrors(e).email;
      if (emailProblem && !challenge) {
        setEmailError(emailProblem);
        invalid.request();
      } else setFormError(describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (!challenge || busy) return;
    setBusy(true);
    setCodeError(null);
    setFormError(null);
    try {
      const me = await session.loginWithOtp(challenge.challengeId, value);
      if (me.kind !== "adult") {
        await session.logout();
        setStaff(true);
        setBusy(false);
        return;
      }
      // teacherIntent — вход с плитки «Я учитель»: выбор «Учиться / Я учитель» (/welcome) пропускается.
      const home = homeOf(me);
      router.replace(teacherIntent && home === "/welcome" ? nextTeacherStep(me) : (home ?? nextTeacherStep(me)));
    } catch (e) {
      const code = e instanceof ApiProblem ? e.code : undefined;
      // Учётная запись сотрудника — объясняет отдельное сообщение (код из письма верный).
      if (code === "totp_required") setStaff(true);
      else if (code === "otp_invalid" || code === "otp_expired" || code === "otp_attempts_exceeded") setCodeError(describeProblem(e));
      else setFormError(describeProblem(e));
      setCode("");
      setBusy(false);
    }
  };

  return (
    <Screen wide top={<SimpleTop wide back="/" title="Вход для учителя" />} className="auth">
      <OnboardLayout step="login">
      <Card roomy className="auth__card">
        {!challenge ? (
          <Form className="tt-stack tt-stack--loose" invalidFocus={invalid} onSubmit={() => void requestCode()}>
            <header className="tt-stack tt-stack--tight">
              <h1 className="tt-title2">Вход по почте</h1>
              <p className="tt-lead">Пришлём код, пароль не нужен.</p>
            </header>
            <TextField
              label="Электронная почта"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="teacher@school.ru"
              icon={<EnvelopeSimple weight="bold" aria-hidden />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError}
              required
              autoFocus
            />
            {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
            <Button type="submit" block loading={busy}>
              Получить код
            </Button>
          </Form>
        ) : (
          <form
            className="tt-stack tt-stack--loose"
            onSubmit={(e) => {
              e.preventDefault();
              void verify(code);
            }}
          >
            <header className="tt-stack tt-stack--tight">
              <h1 className="tt-title2">Введите код</h1>
              <p className="tt-lead">
                Отправили на <b className="tt-break-anywhere">{email.trim()}</b>
              </p>
            </header>
            {demoCode ? (
              <InlineAlert tone="honey">
                Демо: код <b className="tt-num">{demoCode}</b>
              </InlineAlert>
            ) : null}
            <CodeInput
              length={challenge.codeLength}
              label="Код из письма"
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeError(null);
              }}
              onComplete={(v) => void verify(v)}
              error={codeError}
              disabled={busy}
              autoFocus
            />
            {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
            {staff ? (
              <InlineAlert live>
                Это вход сотрудника. Войдите через консоль.
              </InlineAlert>
            ) : null}
            <Button type="submit" block loading={busy} disabled={code.length < challenge.codeLength}>
              Войти
            </Button>
            <div className="tt-row tt-row--wrap auth__links">
              <LinkButton onClick={() => void requestCode()} disabled={wait > 0 || busy}>
                {wait > 0 ? `Новый код через ${wait} с` : "Отправить новый код"}
              </LinkButton>
              <LinkButton
                tone="neutral"
                onClick={() => {
                  setFormError(null);
                  setChallenge(null);
                }}
              >
                Изменить адрес
              </LinkButton>
            </div>
          </form>
        )}
      </Card>
      </OnboardLayout>
    </Screen>
  );
}
