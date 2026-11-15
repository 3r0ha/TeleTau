"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowSquareOut, FileText } from "@phosphor-icons/react/ssr";
import { Button, Card, InlineAlert } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { LoadError, LoadingBlock, Screen, SignOutAction, SimpleTop } from "../../_components/screens";
import { useT } from "../../../i18n/client";
import { clearApplyDraft } from "../applyDraft";
import { OnboardLayout } from "../Journey";
import { nextTeacherStep, useTeacherGate } from "../useTeacher";

/** Принятие условий: действующие версии документов, которые аккаунт ещё не принял (Me.pendingConsents). Одна кнопка «Принять». */
export default function TermsPage() {
  const { me, resource } = useTeacherGate("terms");
  const router = useRouter();
  const t = useT();
  const docs = useResource(() => unwrap(api.GET("/api/v1/legal-documents/current")), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = me ? (docs.data?.items ?? []).filter((d) => me.pendingConsents.includes(d.kind)) : [];

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST("/api/v1/consents", { body: { documentIds: pending.map((d) => d.id) } }));
      const fresh = await unwrap(api.GET("/api/v1/me"));
      session.updateAccount(fresh);
      router.replace(nextTeacherStep(fresh));
    } catch (e) {
      setError(describeProblem(e, "adult", t));
      setBusy(false);
    }
  };

  const error0 = resource.error ?? docs.error;
  return (
    <Screen wide top={<SimpleTop wide title={t("Условия")} end={<SignOutAction onBeforeLogout={clearApplyDraft} />} />} className="auth">
      <OnboardLayout step="terms">
        {error0 && !(me && docs.data) ? (
          <LoadError
            error={error0}
            onRetry={() => {
              resource.reload();
              docs.reload();
            }}
          />
        ) : !me || !docs.data ? (
          <LoadingBlock rows={2} />
        ) : (
          <Card roomy className="auth__card">
            <form
              className="tt-stack tt-stack--loose"
              onSubmit={(e) => {
                e.preventDefault();
                void accept();
              }}
            >
              <h1 className="tt-title2">{t("Примите условия")}</h1>
              <ul className="doc-list">
                {pending.map((d) => (
                  <li key={d.id}>
                    <FileText weight="fill" aria-hidden />
                    <span className="doc-list__text">
                      <b>{d.title}</b>
                    </span>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="tt-link-btn">
                        {t("Читать")} <ArrowSquareOut weight="bold" aria-hidden />
                        <span className="tt-visually-hidden">{t("(откроется в новой вкладке)")}</span>
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              {pending.length === 0 ? <InlineAlert>{t("Документов пока нет. Обновите страницу позже.")}</InlineAlert> : null}
              {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
              <Button type="submit" block loading={busy} disabled={pending.length === 0}>
                {t("Принять")}
              </Button>
            </form>
          </Card>
        )}
      </OnboardLayout>
    </Screen>
  );
}
