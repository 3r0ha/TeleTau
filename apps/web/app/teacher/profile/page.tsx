"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Moon, SignOut } from "@phosphor-icons/react/ssr";
import { Button, Card, Chip, LinkButton, ThemeSwitch } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { useResource } from "@teletau/session/react";
import { LoadError, LoadingBlock } from "../../_components/screens";
import { useT } from "../../../i18n/client";
import { clearApplyDraft } from "../applyDraft";
import { TeacherShell } from "../TeacherShell";
import { useTeacherGate } from "../useTeacher";

/** Профиль учителя: свои данные (видит только он сам) и выход. */
export default function TeacherProfilePage() {
  const { me, resource } = useTeacherGate("any");
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const verification = useResource(() => unwrap(api.GET("/api/v1/teacher/verification")), [me?.id], { enabled: Boolean(me) });

  const logout = async (allDevices: boolean) => {
    setBusy(true);
    clearApplyDraft();
    if (allDevices) {
      // Выход везде: сначала отзыв всех сессий в API, затем — локальный выход (cookie удаляет BFF).
      await api.POST("/api/v1/auth/logout", { body: { allDevices: true } }).catch(() => undefined);
    }
    await session.logout();
    router.replace("/");
  };

  return (
    <TeacherShell>
      <div className="tt-stack tt-stack--loose profile">
        <h1 className="tt-title2">{t("Профиль")}</h1>
        {resource.error && !me ? (
          // Нет связи или ошибка API — текст и повтор, а не бесконечный скелетон.
          <LoadError error={resource.error} onRetry={resource.reload} />
        ) : !me ? (
          <LoadingBlock rows={1} />
        ) : (
          <Card roomy>
            <dl className="facts-list">
              <div>
                <dt>{t("ФИО")}</dt>
                <dd>{me.profile?.fullName ?? verification.data?.applicant.fullName ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("Почта")}</dt>
                <dd className="tt-break-anywhere">{me.profile?.email ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("Школа")}</dt>
                <dd>{verification.data?.school.shortNameRu ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("Статус")}</dt>
                <dd>
                  {me.teacherStatus === "verified" ? (
                    <Chip tone="green">{t("Учитель подтверждён")}</Chip>
                  ) : me.teacherStatus === "pending" ? (
                    <Chip tone="honey">{t("Заявка на проверке")}</Chip>
                  ) : me.teacherStatus === "rejected" ? (
                    <Chip tone="coral">{t("Заявка отклонена")}</Chip>
                  ) : (
                    <Chip tone="neutral">{t("Заявки нет")}</Chip>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        )}
        <Card as="section" className="settings" aria-label={t("Настройки")}>
          <div className="settings__row">
            <Moon weight="fill" aria-hidden />
            <span className="settings__name" id="teacher-theme-label">
              {t("Тёмная тема")}
            </span>
            <ThemeSwitch labelledBy="teacher-theme-label" />
          </div>
        </Card>
        <div className="tt-stack tt-stack--tight profile__actions">
          <Button variant="secondary" block icon={<SignOut weight="bold" />} loading={busy} onClick={() => void logout(false)}>
            {t("Выйти")}
          </Button>
          <LinkButton tone="danger" onClick={() => void logout(true)} disabled={busy}>
            {t("Выйти на всех устройствах")}
          </LinkButton>
        </div>
      </div>
    </TeacherShell>
  );
}
