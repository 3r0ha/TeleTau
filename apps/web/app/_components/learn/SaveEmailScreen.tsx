"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, CodeInput, EmptyState, Form, InlineAlert, LinkButton, StepHeading, TextField, useInvalidFocus } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { ApiProblem, describeProblem, fieldErrors } from "@teletau/session/problem";
import { LoadingBlock, Screen, SimpleTop, useDocumentTitle } from "../screens";
import { useStudentPaths } from "./paths";
import { selfApi } from "./self-api";
import { useStudent } from "./StudentShell";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Сохранить прогресс по почте» (ADR 0022 §10): аккаунт без почты привязывает адрес — код из письма, как при входе.
 * Дальше вход по почте с любого устройства; карточка входа больше не нужна. Детям привязка разрешена по решению
 * владельца: сам адрес не хранится, поэтому на экране он не показывается (у ребёнка о привязке знает только сервер).
 */
export function SaveEmailScreen({ demoCode }: { demoCode: string | null }) {
  const me = useStudent();
  const paths = useStudentPaths();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Schema<"OtpChallenge"> | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = useInvalidFocus();
  useDocumentTitle(challenge ? "Код из письма" : "Сохранить по почте");

  const request = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Нужен адрес почты, например name@mail.ru");
      invalid.request();
      return;
    }
    setBusy(true);
    setEmailError(null);
    setFormError(null);
    try {
      setChallenge(await selfApi.requestOtp(email.trim()));
      setCode("");
    } catch (e) {
      const bad = fieldErrors(e).email;
      if (bad) {
        setEmailError(bad);
        invalid.request();
      } else setFormError(describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  const attach = async (value: string) => {
    if (!challenge || busy) return;
    setBusy(true);
    setCodeError(null);
    setFormError(null);
    try {
      const updated = await selfApi.attachEmail({ challengeId: challenge.challengeId, code: value });
      session.updateAccount(updated);
      router.replace(paths.me);
    } catch (e) {
      const c = e instanceof ApiProblem ? e.code : undefined;
      if (c === "otp_invalid" || c === "otp_expired" || c === "otp_attempts_exceeded") setCodeError(describeProblem(e));
      else setFormError(describeProblem(e));
      setCode("");
      setBusy(false);
    }
  };

  return (
    <Screen top={<SimpleTop back={paths.me} title="Сохранить по почте" />} className="auth">
      {!me ? (
        <LoadingBlock rows={2} />
      ) : me.profile || me.emailLogin ? (
        <EmptyState art="beeIdle" title="Почта уже сохранена">
          Входи по почте с любого устройства.
        </EmptyState>
      ) : !challenge ? (
        <Form className="tt-stack tt-stack--loose" invalidFocus={invalid} onSubmit={() => void request()}>
          <header className="tt-stack tt-stack--tight">
            <StepHeading focusKey="email">Сохранить прогресс по почте</StepHeading>
            <p className="tt-lead">Будешь входить с любого устройства по коду из письма.</p>
          </header>
          <TextField
            label="Электронная почта"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
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
            void attach(code);
          }}
        >
          <header className="tt-stack tt-stack--tight">
            <StepHeading focusKey="code">Введи код</StepHeading>
            <p className="tt-lead">
              Код отправлен на <b className="tt-break-anywhere">{email.trim()}</b>.
            </p>
          </header>
          {demoCode ? (
            <InlineAlert tone="honey">
              Демо-режим: код всегда <b className="tt-num">{demoCode}</b>.
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
            onComplete={(v) => void attach(v)}
            error={codeError}
            disabled={busy}
            autoFocus
          />
          {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
          <Button type="submit" block loading={busy} disabled={code.length < challenge.codeLength}>
            Сохранить
          </Button>
          <LinkButton tone="neutral" onClick={() => setChallenge(null)}>
            Другой адрес
          </LinkButton>
        </form>
      )}
    </Screen>
  );
}
