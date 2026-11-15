"use client";

// Вход по почте в Mini App: взрослый (или ребёнок с привязанной почтой) входит в рамку Telegram той же почтой,
// что и на сайте. Сессия появляется в самой рамке — LinkChat (TelegramProvider) сразу связывает чат с ботом
// (ADR 0020) без кода из профиля, и напоминания с дуэлями начинают приходить. Новичку без ника после кода —
// выбор ника, как в «Учусь сам»; сотруднику — «войдите через консоль» (сайт для сотрудников не работает).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, LinkButton } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { CodeStep, EmailStep, useEmailOtp } from "../EmailOtp";
import { useDocumentTitle, Screen, SimpleTop } from "../screens";
import { DEFAULT_GOAL } from "../learn/GoalPicker";
import { selfApi } from "../learn/self-api";
import { useStudentPaths } from "../learn/paths";
import { NicknamePicker } from "../../student/NicknamePicker";
import { useT } from "../../../i18n/client";

/**
 * Шаги: почта → код из письма → (новичку без ника) выбор ника → тропа. Демо-код показывает сервер
 * (AUTH_DEMO_OTP) — тот же ориентир, что на сайте. Ссылка «Изменить адрес» возвращает к первому шагу.
 */
export function EmailLogin({ demoCode }: { demoCode: string | null }) {
  const router = useRouter();
  const paths = useStudentPaths();
  const t = useT();
  // Ник ещё не выбран: после кода — шаг выбора, как «Учусь сам» (ADR 0022). Вид аккаунта решает,
  // что писать в /me: взрослому — возраст и цель дня, ребёнку достаточно ника.
  const [pickNickname, setPickNickname] = useState(false);
  const [meKind, setMeKind] = useState<"child" | "adult" | null>(null);
  const otp = useEmailOtp((me) => {
    if (me.nickname) {
      router.replace(paths.learn);
      return true;
    }
    // Новичок без ника: шаг выбора ника; кнопка «Начать» не должна остаться в загрузке.
    setMeKind(me.kind === "child" ? "child" : "adult");
    setPickNickname(true);
    return false;
  });
  const { busy, setBusy, formError, setFormError } = otp;
  useDocumentTitle(otp.challenge && !pickNickname ? t("Введите код") : pickNickname ? t("Твой ник") : t("Вход по почте"));

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
      setFormError(describeProblem(e, "adult", t));
      setBusy(false);
    }
  };

  return (
    // Заголовок экрана — в карточке (h1): верхняя панель его не повторяет.
    <Screen wide top={<SimpleTop back={paths.login} />}>
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
        ) : otp.challenge ? (
          <CodeStep otp={otp} demoCode={demoCode} />
        ) : (
          <EmailStep otp={otp} />
        )}
      </Card>
    </Screen>
  );
}
