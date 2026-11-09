"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ButtonLink, Card, Illustration, InlineAlert } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { useResource } from "@teletau/session/react";
import { LoadError, LoadingBlock, Screen, SignOutAction, SimpleTop, isNotFound } from "../../_components/screens";
import { clearApplyDraft } from "../applyDraft";
import { OnboardLayout } from "../Journey";
import { useTeacherGate } from "../useTeacher";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yekaterinburg" });

/**
 * Заявка на проверке: сколько ждать и что отправлено (шаги пути — в панели «Кабинет учителя»). Страница опрашивает
 * GET /me и после одобрения сама переходит в кабинет (useTeacherGate; роль teacher появится после обновления токена —
 * ADR 0015). Заявку не подтвердили — почему (если указано) и «Подать заявку заново».
 */
export default function PendingPage() {
  const { me, resource } = useTeacherGate("pending", { pollMs: 10_000 });
  const router = useRouter();
  const verification = useResource(() => unwrap(api.GET("/api/v1/teacher/verification")), [me?.teacherStatus], { enabled: Boolean(me) });

  useEffect(() => {
    if (verification.error && isNotFound(verification.error)) router.replace("/teacher/apply");
  }, [verification.error, router]);

  const v = verification.data;
  const rejected = me?.teacherStatus === "rejected" || v?.status === "rejected";
  // Заявку не удалось загрузить (не «нет заявки» — тогда переход на /teacher/apply): ошибка с повтором, а не молчаливое
  // «Заявка на проверке» без данных.
  const verificationFailed = Boolean(verification.error) && !v && !isNotFound(verification.error);

  return (
    <Screen wide top={<SimpleTop wide title="Заявка учителя" end={<SignOutAction onBeforeLogout={clearApplyDraft} />} />} className="auth">
      <OnboardLayout step={rejected ? "apply" : "pending"}>
        {resource.error && !me ? (
          <LoadError error={resource.error} onRetry={resource.reload} />
        ) : verificationFailed ? (
          <LoadError error={verification.error} onRetry={verification.reload} />
        ) : !me || (!v && !verification.error) ? (
          <LoadingBlock rows={2} />
        ) : rejected ? (
          <Card roomy className="auth__card wait">
            <div className="wait__head">
              <Illustration name="beeSympathy" width={96} className="wait__art" />
              <div className="tt-stack tt-stack--tight">
                <h1 className="tt-title2">Заявку не подтвердили</h1>
                <p className="tt-lead">Проверьте данные и отправьте заявку снова.</p>
              </div>
            </div>
            {v?.decisionReason ? (
              <InlineAlert tone="danger">
                <b>Причина:</b> {v.decisionReason}
              </InlineAlert>
            ) : null}
            <ButtonLink href="/teacher/apply" block>
              Подать заявку заново
            </ButtonLink>
          </Card>
        ) : (
          <Card roomy className="auth__card wait">
            <div className="wait__head" role="status">
              <Illustration name="beeIdle" width={96} className="wait__art" />
              <div className="tt-stack tt-stack--tight">
                <h1 className="tt-title2">Заявка на проверке</h1>
                <p className="tt-lead">Обычно до одного рабочего дня. Страницу можно закрыть.</p>
              </div>
            </div>
            {v ? (
              <dl className="facts-list">
                <div>
                  <dt>Школа</dt>
                  <dd>{v.school.shortNameRu}</dd>
                </div>
                <div>
                  <dt>Должность</dt>
                  <dd>{v.position}</dd>
                </div>
                <div>
                  <dt>Отправлена</dt>
                  <dd>{dateFmt.format(new Date(v.createdAt))}</dd>
                </div>
              </dl>
            ) : null}
          </Card>
        )}
      </OnboardLayout>
    </Screen>
  );
}
