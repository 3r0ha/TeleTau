"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Brand, Button, Card, CodeInput, Form, InlineAlert, LinkButton, ProgressBar, TextField, TopBar, useInvalidFocus } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { isEmail } from "@teletau/session/email";
import { ApiProblem, describeProblem, fieldErrors } from "@teletau/session/problem";
import { homeOf, isStaff } from "../_components/sections";

type Step = "email" | "code" | "totp";

export function StaffLogin({ demoCode, totpDisabled }: { demoCode: string | null; totpDisabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<Schema<"OtpChallenge"> | null>(null);
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Сбой сервера или сети — не ошибка поля: сообщение role="alert", поле без aria-invalid, фокус не уводится.
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ошибка шага почты — у поля почты; фокус переходит на него. Ячейки кода переводят фокус сами (CodeInput).
  const invalid = useInvalidFocus();

  // Переход по кнопке «Дальше», «Изменить адрес» или «Назад»: ошибки прежнего шага к новому не относятся.
  const goTo = (next: Step) => {
    setError(null);
    setAlert(null);
    setStep(next);
  };

  const requestCode = async () => {
    if (!isEmail(email)) {
      setError("Проверьте адрес почты.");
      invalid.request();
      return;
    }
    setBusy(true);
    setError(null);
    setAlert(null);
    try {
      setChallenge(await unwrap(api.POST("/api/v1/auth/otp/request", { body: { email: email.trim() } })));
      setCode("");
      setTotp("");
      goTo("code");
    } catch (e) {
      const emailProblem = fieldErrors(e).email;
      if (emailProblem) {
        setError(emailProblem);
        invalid.request();
      } else setAlert(describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (totpValue: string) => {
    if (!challenge || busy) return;
    setBusy(true);
    setError(null);
    setAlert(null);
    try {
      const me = await session.loginWithOtp(challenge.challengeId, code, totpValue);
      if (!isStaff(me)) {
        await session.logout();
        setError("Нет доступа к консоли.");
        setStep("email");
        invalid.request();
        setBusy(false);
        return;
      }
      router.replace(homeOf(me));
    } catch (e) {
      setBusy(false);
      setTotp("");
      if (e instanceof ApiProblem && (e.code === "otp_invalid" || e.code === "otp_expired" || e.code === "otp_attempts_exceeded")) {
        setCode("");
        setStep(e.code === "otp_invalid" ? "code" : "email");
        // Код устарел — снова шаг почты: ошибка у поля почты, фокус на нём.
        if (e.code !== "otp_invalid") invalid.request();
        setError(describeProblem(e));
      } else if (e instanceof ApiProblem && e.code === "totp_invalid") setError(describeProblem(e));
      // Остальное (блокировка, лимит, сбой сервера или сети) — не ошибка введённого кода.
      else setAlert(describeProblem(e));
    }
  };

  // Демо без второго фактора (AUTH_DEMO_STAFF_WITHOUT_TOTP): «почта → код» — два шага вместо трёх.
  const steps: Step[] = totpDisabled ? ["email", "code"] : ["email", "code", "totp"];
  const stepNo = step === "email" ? 1 : step === "code" ? 2 : 3;
  return (
    <div className="tt-page console">
      <TopBar wide start={<Brand href="/login" subtitle="Консоль" />} />
      <main id="main" className="tt-main">
        <div className="tt-column console__body console__login">
          <Card roomy>
            <div className="tt-stack tt-stack--loose">
              <ProgressBar value={stepNo} max={steps.length} label="Шаг входа" valueText={`Шаг ${stepNo} из ${steps.length}`} showValue />
              {step === "email" ? (
                <Form className="tt-stack tt-stack--loose" invalidFocus={invalid} onSubmit={() => void requestCode()}>
                  <header className="tt-stack tt-stack--tight">
                    <h1 className="tt-title2">Вход сотрудника</h1>
                    <p className="tt-lead">{totpDisabled ? "Нужны почта и код из письма." : "Нужны почта и приложение-аутентификатор."}</p>
                  </header>
                  <TextField
                    label="Рабочая почта"
                    type="email"
                    autoComplete="username"
                    icon={<EnvelopeSimple weight="bold" aria-hidden />}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={error}
                    autoFocus
                  />
                  {alert ? <InlineAlert tone="danger">{alert}</InlineAlert> : null}
                  <Button type="submit" block loading={busy}>
                    Получить код
                  </Button>
                </Form>
              ) : step === "code" ? (
                <form
                  className="tt-stack tt-stack--loose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.length !== challenge?.codeLength) return;
                    if (totpDisabled) void verify("");
                    else goTo("totp");
                  }}
                >
                  <header className="tt-stack tt-stack--tight">
                    <h1 className="tt-title2">Код из письма</h1>
                    <p className="tt-lead">
                      Отправлен на <b className="tt-break-anywhere">{email.trim()}</b>.
                    </p>
                  </header>
                  {demoCode ? (
                    <InlineAlert tone="honey">
                      Демо: код <b className="tt-num">{demoCode}</b>
                    </InlineAlert>
                  ) : null}
                  <CodeInput
                    length={challenge?.codeLength ?? 4}
                    label="Код из письма"
                    value={code}
                    onChange={(v) => {
                      setCode(v);
                      setError(null);
                    }}
                    onComplete={(v) => {
                      if (v.length !== challenge?.codeLength) return;
                      if (totpDisabled) void verify("");
                      else goTo("totp");
                    }}
                    error={error}
                    autoFocus
                  />
                  {alert ? <InlineAlert tone="danger">{alert}</InlineAlert> : null}
                  <Button type="submit" block loading={busy && totpDisabled} disabled={code.length !== challenge?.codeLength}>
                    {totpDisabled ? "Войти" : "Дальше"}
                  </Button>
                  <LinkButton tone="neutral" onClick={() => goTo("email")}>
                    Изменить адрес
                  </LinkButton>
                </form>
              ) : (
                <form
                  className="tt-stack tt-stack--loose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void verify(totp);
                  }}
                >
                  <header className="tt-stack tt-stack--tight">
                    <h1 className="tt-title2">Код из приложения</h1>
                    <p className="tt-lead">6 цифр из приложения-аутентификатора.</p>
                  </header>
                  {demoCode ? <InlineAlert>Демо: секрет TOTP — в apps/api/data/README.md</InlineAlert> : null}
                  <CodeInput
                    length={6}
                    compact
                    label="Код из приложения-аутентификатора"
                    value={totp}
                    onChange={(v) => {
                      setTotp(v);
                      setError(null);
                    }}
                    onComplete={(v) => void verify(v)}
                    error={error}
                    disabled={busy}
                    autoFocus
                  />
                  {alert ? <InlineAlert tone="danger">{alert}</InlineAlert> : null}
                  <Button type="submit" block loading={busy} disabled={totp.length !== 6}>
                    Войти
                  </Button>
                  <LinkButton tone="neutral" onClick={() => goTo("code")}>
                    Назад к коду из письма
                  </LinkButton>
                </form>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
