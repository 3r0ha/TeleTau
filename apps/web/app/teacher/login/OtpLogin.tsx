"use client";

import { useRouter } from "next/navigation";
import { Card } from "@teletau/ui";
import { Screen, SimpleTop, useDocumentTitle } from "../../_components/screens";
import { CodeStep, EmailStep, useEmailOtp } from "../../_components/EmailOtp";
import { homeOf } from "../../_components/home";
import { useT } from "../../../i18n/client";
import { OnboardLayout } from "../Journey";
import { nextTeacherStep } from "../useTeacher";

/** Вход по почте: e-mail → код (в демо-режиме — фиксированный). Ребёнок с почтой — сразу на тропу, взрослый — выбор «Учиться / Я учитель» или дальше по этапам. */
export function OtpLogin({ demoCode, teacherIntent = false, consoleUrl }: { demoCode: string | null; teacherIntent?: boolean; consoleUrl?: string }) {
  const router = useRouter();
  const t = useT();
  const otp = useEmailOtp((me) => {
    // Ребёнок с привязанной почтой — сразу на свою тропу (выбор ника, если его ещё нет).
    // teacherIntent — вход с плитки «Я учитель»: выбор «Учиться / Я учитель» (/welcome) пропускается.
    const home = homeOf(me);
    router.replace(teacherIntent && home === "/welcome" ? nextTeacherStep(me) : (home ?? nextTeacherStep(me)));
    return true;
  });
  // У шага ввода кода — свой заголовок вкладки, как у шагов заявки и кода класса.
  useDocumentTitle(otp.challenge ? t("Введите код") : teacherIntent ? t("Вход для учителя") : t("Вход по почте"));

  return (
    // Заголовок экрана — в карточке (h1): верхняя панель его не повторяет.
    <Screen wide top={<SimpleTop wide back="/" />} className="auth">
      <OnboardLayout step="login">
        <Card roomy className="auth__card">
          {otp.challenge ? <CodeStep otp={otp} demoCode={demoCode} consoleUrl={consoleUrl} linksClassName="auth__links" /> : <EmailStep otp={otp} />}
        </Card>
      </OnboardLayout>
    </Screen>
  );
}
