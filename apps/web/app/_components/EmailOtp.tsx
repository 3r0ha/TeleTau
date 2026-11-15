"use client";

// Вход по почте на сайте и в Mini App: почта → одноразовый код из письма. Общие состояние и шаги; что делать с
// аккаунтом после кода, решает экран (onAccount). Учётная запись сотрудника на сайт не входит — сессия прибирается,
// экран говорит «войдите через консоль».
import { useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, ButtonLink, CodeInput, Form, InlineAlert, LinkButton, TextField, useInvalidFocus, type InvalidFocus } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { isEmail } from "@teletau/session/email";
import { ApiProblem, describeProblem, fieldErrors } from "@teletau/session/problem";
import { useCountdown } from "@teletau/session/react";
import type { Me } from "@teletau/session/types";
import { useT } from "../../i18n/client";

type Challenge = Schema<"OtpChallenge">;

export interface EmailOtp {
  email: string;
  setEmail: (value: string) => void;
  emailError: string | null;
  /** Код запрошен — шаг ввода кода. */
  challenge: Challenge | null;
  code: string;
  setCode: (value: string) => void;
  codeError: string | null;
  /** Сбой сервера или сети — не ошибка поля: сообщение role="alert", поле без aria-invalid, фокус не уводится. */
  formError: string | null;
  setFormError: (value: string | null) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  /** Код верный, но это учётная запись сотрудника. */
  staff: boolean;
  /** Секунд до «Отправить новый код». */
  wait: number;
  invalid: InvalidFocus;
  requestCode: () => Promise<void>;
  verify: (value: string) => Promise<void>;
  /** «Изменить адрес»: к шагу почты, ошибки шага кода не переносятся. */
  changeEmail: () => void;
}

/**
 * Состояние входа по почте. onAccount — аккаунт после верного кода (не сотрудник): true — экран уходит дальше
 * (кнопка остаётся в загрузке до перехода), false — остаётся здесь (например, выбор ника).
 */
export function useEmailOtp(onAccount: (me: Me) => boolean): EmailOtp {
  const t = useT();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [code, setCodeValue] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState(false);
  const wait = useCountdown(resendAt);
  const invalid = useInvalidFocus();

  const requestCode = async () => {
    if (!isEmail(email)) {
      setEmailError(t("Проверьте адрес почты"));
      invalid.request();
      return;
    }
    setBusy(true);
    setEmailError(null);
    setFormError(null);
    setStaff(false);
    try {
      const c = await unwrap(api.POST("/api/v1/auth/otp/request", { body: { email: email.trim() } }));
      setChallenge(c);
      setResendAt(Date.now() + c.resendAfterSeconds * 1000);
      setCodeValue("");
      setCodeError(null);
    } catch (e) {
      // Адрес отклонил сервер (422 /email) — ошибка у поля и фокус на нём. Остальное (сбой, сеть, лимит) и повторная
      // отправка с шага кода, где поля почты нет, — сообщением: введённое верно.
      const emailProblem = fieldErrors(e, t).email;
      if (emailProblem && !challenge) {
        setEmailError(emailProblem);
        invalid.request();
      } else setFormError(describeProblem(e, "adult", t));
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
      if (me.kind === "staff") {
        await session.logout();
        setStaff(true);
        setBusy(false);
        return;
      }
      if (!onAccount(me)) setBusy(false);
    } catch (e) {
      const problem = e instanceof ApiProblem ? e.code : undefined;
      // Сотрудник с TOTP: код из письма верный — объясняет отдельное сообщение.
      if (problem === "totp_required") setStaff(true);
      else if (problem === "otp_invalid" || problem === "otp_expired" || problem === "otp_attempts_exceeded") setCodeError(describeProblem(e, "adult", t));
      else setFormError(describeProblem(e, "adult", t));
      setCodeValue("");
      setBusy(false);
    }
  };

  const setCode = (value: string) => {
    setCodeValue(value);
    setCodeError(null);
  };

  const changeEmail = () => {
    setFormError(null);
    setCodeError(null);
    setStaff(false);
    setChallenge(null);
  };

  return { email, setEmail, emailError, challenge, code, setCode, codeError, formError, setFormError, busy, setBusy, staff, wait, invalid, requestCode, verify, changeEmail };
}

/** Шаг почты: заголовок, поле, сообщение о сбое, «Получить код». */
export function EmailStep({ otp }: { otp: EmailOtp }) {
  const t = useT();
  return (
    <Form className="tt-stack tt-stack--loose" invalidFocus={otp.invalid} onSubmit={() => void otp.requestCode()}>
      <header className="tt-stack tt-stack--tight">
        <h1 className="tt-title2">{t("Вход по почте")}</h1>
        <p className="tt-lead">{t("Пришлём код, пароль не нужен. Новичку аккаунт создастся сам.")}</p>
      </header>
      <TextField
        label={t("Электронная почта")}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="ivan@example.ru"
        icon={<EnvelopeSimple weight="bold" aria-hidden />}
        value={otp.email}
        onChange={(e) => otp.setEmail(e.target.value)}
        error={otp.emailError}
        required
        autoFocus
      />
      {otp.formError ? <InlineAlert tone="danger">{otp.formError}</InlineAlert> : null}
      <Button type="submit" block loading={otp.busy}>
        {t("Получить код")}
      </Button>
    </Form>
  );
}

/** Шаг кода: ячейки кода, демо-код, «Войти», новый код по таймеру и «Изменить адрес». consoleUrl — ссылка сотруднику. */
export function CodeStep({ otp, demoCode, consoleUrl, linksClassName }: { otp: EmailOtp; demoCode: string | null; consoleUrl?: string; linksClassName?: string }) {
  const t = useT();
  const challenge = otp.challenge;
  if (!challenge) return null;
  return (
    <form
      className="tt-stack tt-stack--loose"
      onSubmit={(e) => {
        e.preventDefault();
        void otp.verify(otp.code);
      }}
    >
      <header className="tt-stack tt-stack--tight">
        <h1 className="tt-title2">{t("Введите код")}</h1>
        <p className="tt-lead">
          {t("Отправили на")} <b className="tt-break-anywhere">{otp.email.trim()}</b>
        </p>
      </header>
      {demoCode ? (
        <InlineAlert tone="honey">
          {t("Демо: код")} <b className="tt-num">{demoCode}</b>
        </InlineAlert>
      ) : null}
      <CodeInput
        length={challenge.codeLength}
        label={t("Код из письма")}
        value={otp.code}
        onChange={otp.setCode}
        onComplete={(v) => void otp.verify(v)}
        error={otp.codeError}
        disabled={otp.busy}
        autoFocus
      />
      {otp.formError ? <InlineAlert tone="danger">{otp.formError}</InlineAlert> : null}
      {otp.staff ? (
        <InlineAlert live>
          {t("Это вход сотрудника. Войдите через консоль.")}
          {consoleUrl ? (
            <p>
              <ButtonLink href={consoleUrl} small>
                {t("Открыть консоль")}
              </ButtonLink>
            </p>
          ) : null}
        </InlineAlert>
      ) : null}
      <Button type="submit" block loading={otp.busy} disabled={otp.code.length < challenge.codeLength}>
        {t("Войти")}
      </Button>
      <div className={["tt-row tt-row--wrap", linksClassName].filter(Boolean).join(" ")}>
        <LinkButton onClick={() => void otp.requestCode()} disabled={otp.wait > 0 || otp.busy}>
          {otp.wait > 0 ? t("Новый код через {n} с", { n: otp.wait }) : t("Отправить новый код")}
        </LinkButton>
        <LinkButton tone="neutral" onClick={otp.changeEmail}>
          {t("Изменить адрес")}
        </LinkButton>
      </div>
    </form>
  );
}
