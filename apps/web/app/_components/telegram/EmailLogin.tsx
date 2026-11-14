"use client";

// Вход по почте в Mini App: взрослый (или ребёнок с привязанной почтой) входит в рамку Telegram той же почтой,
// что и на сайте. Сессия появляется в самой рамке — LinkChat (TelegramProvider) сразу связывает чат с ботом
// (ADR 0020) без кода из профиля, и напоминания с дуэлями начинают приходить. Новичку без ника после кода —
// выбор ника, как в «Учусь сам»; сотруднику — «войдите через консоль» (сайт для сотрудников не работает).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Card, CodeInput, Form, InlineAlert, LinkButton, TextField, useInvalidFocus } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { ApiProblem, describeProblem, fieldErrors } from "@teletau/session/problem";
import { useDocumentTitle, Screen, SimpleTop } from "../screens";
import { DEFAULT_GOAL } from "../learn/GoalPicker";
import { selfApi } from "../learn/self-api";
import { useStudentPaths } from "../learn/paths";
import { NicknamePicker } from "../../student/NicknamePicker";
import { useT } from "../../../i18n/client";

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

/**
 * Шаги: почта → код из письма → (новичку без ника) выбор ника → тропа. Демо-код показывает сервер
 * (AUTH_DEMO_OTP) — тот же ориентир, что на сайте. Ссылка «Изменить адрес» возвращает к первому шагу.
 */
export function EmailLogin({ demoCode }: { demoCode: string | null }) {
  const router = useRouter();
  const paths = useStudentPaths();
  const t = useT();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  // Сбой сервера или сети — не ошибка поля: сообщение role="alert", поле без aria-invalid, фокус не уводится.
  const [formError, setFormError] = useState<string | null>(null);
  const [staff, setStaff] = useState(false);
  // Ник ещё не выбран: после кода — шаг выбора, как «Учусь сам» (ADR 0022). Вид аккаунта решает,
  // что писать в /me: взрослому — возраст и цель дня, ребёнку достаточно ника.
  const [pickNickname, setPickNickname] = useState(false);
  const [meKind, setMeKind] = useState<"child" | "adult" | null>(null);
  const [busy, setBusy] = useState(false);
  const wait = useCountdown(resendAt);
  const invalid = useInvalidFocus();
  useDocumentTitle(challenge ? t("Введите код") : pickNickname ? t("Твой ник") : t("Вход по почте"));

  const requestCode = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError(t("Проверьте адрес почты"));
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
      // Адрес отклонил сервер (422 /email) — ошибка у поля и фокус на нём; остальное — сообщением.
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
      // Сотруднику вход не сюда: консоль — отдельное приложение, сессию прибираем.
      if (me.kind === "staff") {
        await session.logout();
        setStaff(true);
        setBusy(false);
        return;
      }
      if (me.nickname) router.replace(paths.learn);
      else {
        setMeKind(me.kind === "child" ? "child" : "adult");
        setPickNickname(true);
      }
    } catch (e) {
      const code = e instanceof ApiProblem ? e.code : undefined;
      if (code === "otp_invalid" || code === "otp_expired" || code === "otp_attempts_exceeded") setCodeError(describeProblem(e));
      else setFormError(describeProblem(e));
      setCode("");
      setBusy(false);
    }
  };

  const pick = async (nicknameId: string, adult: boolean) => {
    setBusy(true);
    setFormError(null);
    try {
      const updated = await selfApi.updateMe(
        // Взрослому — возраст и цель дня, как выбор «Учиться» на сайте (welcome); ребёнку достаточно ника.
        adult ? { nicknameId, ageBand: "adult", dailyGoal: DEFAULT_GOAL } : { nicknameId },
      );
      session.updateAccount(updated);
      router.replace(paths.learn);
    } catch (e) {
      setFormError(describeProblem(e));
      setBusy(false);
    }
  };

  return (
    <Screen wide top={<SimpleTop back={paths.login} title={t("Вход по почте")} />}>
      <Card roomy>
        {pickNickname ? (
          <div className="tt-stack tt-stack--loose">
            <header className="tt-stack tt-stack--tight">
              <h1 className="tt-title2">{t("Выбери ник")}</h1>
              {/* Подпись зависит от вида аккаунта: взрослый учится сам — «в классе» его никто не увидит. */}
              <p className="tt-lead">
                {meKind === "child" ? t("Так тебя увидят в классе.") : t("Так тебя увидят в дуэлях «Помоги языку».")}
              </p>
            </header>
            <NicknamePicker
              submitLabel={t("Начать")}
              submitting={busy}
              error={formError}
              onPick={(nick) => void pick(nick.id, meKind === "adult")}
            />
            <LinkButton tone="neutral" onClick={() => void session.logout().then(() => router.replace(paths.login))}>
              {t("Выйти")}
            </LinkButton>
          </div>
        ) : !challenge ? (
          <Form className="tt-stack tt-stack--loose" invalidFocus={invalid} onSubmit={() => void requestCode()}>
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError}
              required
              autoFocus
            />
            {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
            <Button type="submit" block loading={busy}>
              {t("Получить код")}
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
              <h1 className="tt-title2">{t("Введите код")}</h1>
              <p className="tt-lead">
                {t("Отправили на")} <b className="tt-break-anywhere">{email.trim()}</b>
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
            {staff ? <InlineAlert live>{t("Это вход сотрудника. Войдите через консоль.")}</InlineAlert> : null}
            <Button type="submit" block loading={busy} disabled={code.length < challenge.codeLength}>
              {t("Войти")}
            </Button>
            <div className="tt-row tt-row--wrap">
              <LinkButton onClick={() => void requestCode()} disabled={wait > 0 || busy}>
                {wait > 0 ? t("Новый код через {n} с", { n: wait }) : t("Отправить новый код")}
              </LinkButton>
              <LinkButton
                tone="neutral"
                onClick={() => {
                  setFormError(null);
                  setChallenge(null);
                }}
              >
                {t("Изменить адрес")}
              </LinkButton>
            </div>
          </form>
        )}
      </Card>
    </Screen>
  );
}
