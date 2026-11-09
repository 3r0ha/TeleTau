"use client";

import { useEffect, useState } from "react";
import { Check, X } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Chip, Dialog, EmptyState, Form, InlineAlert, LinkButton, Skeleton, SkeletonGroup, TextArea, useInvalidFocus, useToast } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem, fieldErrors, isNetworkError } from "@teletau/session/problem";
import { useCursorList } from "@teletau/session/react";
import { ConsoleShell } from "../_components/ConsoleShell";

type Verification = Schema<"TeacherVerification">;
type Status = Schema<"TeacherVerificationStatus">;

const TABS: { status: Status; label: string }[] = [
  { status: "pending", label: "На проверке" },
  { status: "approved", label: "Одобренные" },
  { status: "rejected", label: "Отклонённые" },
];

const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yekaterinburg" });
/** Заявок на странице очереди. */
const PAGE = 50;

export default function VerificationsPage() {
  return <ConsoleShell section="verifications">{() => <Queue />}</ConsoleShell>;
}

/** Очередь заявок учителей: старые сверху; одобрить или отклонить с причиной (видна заявителю, пишется в аудит). */
function Queue() {
  const toast = useToast();
  const [status, setStatus] = useState<Status>("pending");
  // «Показать ещё»: один запрос за раз и без дублей по id — useCursorList.
  const list = useCursorList<Verification>();
  const { items } = list;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Verification | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const invalid = useInvalidFocus();
  const { reset } = list;

  useEffect(() => {
    let cancelled = false;
    reset(null);
    setError(null);
    unwrap(api.GET("/api/v1/moderation/teacher-verifications", { params: { query: { status, limit: PAGE } } }))
      .then((page) => !cancelled && reset(page))
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [status, tick, reset]);

  const more = () =>
    list
      .loadMore((cursor) => unwrap(api.GET("/api/v1/moderation/teacher-verifications", { params: { query: { status, cursor, limit: PAGE } } })))
      .catch((e: unknown) => toast(describeProblem(e), "error"));

  const drop = (id: string) => list.update((rows) => rows.filter((v) => v.id !== id));

  const approve = async (v: Verification) => {
    setBusy(v.id);
    try {
      await unwrap(api.POST("/api/v1/moderation/teacher-verifications/{id}/approve", { params: { path: { id: v.id } } }));
      drop(v.id);
      toast(`Заявка одобрена: ${v.applicant.fullName}`);
    } catch (e) {
      toast(describeProblem(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    if (reason.trim().length < 3) {
      setReasonError("Напишите причину, от 3 символов.");
      invalid.request();
      return;
    }
    setBusy(rejecting.id);
    setRejectError(null);
    try {
      await unwrap(api.POST("/api/v1/moderation/teacher-verifications/{id}/reject", { params: { path: { id: rejecting.id } }, body: { reason: reason.trim() } }));
      drop(rejecting.id);
      toast(`Заявка отклонена: ${rejecting.applicant.fullName}`, "info");
      setRejecting(null);
    } catch (e) {
      // Ошибка поля (422 /reason) — у поля и фокус туда; сбой сервера или сети — сообщением, причина верна.
      const reasonProblem = fieldErrors(e).reason;
      if (reasonProblem) {
        setReasonError(reasonProblem);
        invalid.request();
      } else setRejectError(describeProblem(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tt-stack tt-stack--loose">
      <header className="console__head">
        <h1 className="tt-title2">Заявки учителей</h1>
        <div className="segmented" role="group" aria-label="Статус заявок">
          {TABS.map((t) => (
            <button key={t.status} type="button" aria-pressed={status === t.status} onClick={() => setStatus(t.status)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {error && !items ? (
        <EmptyState
          art={isNetworkError(error) ? "emptyOffline" : "emptyError"}
          headingAs="h2"
          compact
          title={isNetworkError(error) ? "Нет связи" : "Не удалось загрузить"}
          role="alert"
          actions={
            <Button block onClick={() => setTick((n) => n + 1)}>
              Попробовать снова
            </Button>
          }
        >
          {describeProblem(error)}
        </EmptyState>
      ) : !items ? (
        <SkeletonGroup label="Загружаем заявки" className="tt-stack tt-stack--tight">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={64} radius="tile" />
          ))}
        </SkeletonGroup>
      ) : items.length === 0 ? (
        <EmptyState art="emptyAllDone" headingAs="h2" compact title={status === "pending" ? "Очередь пуста" : "Заявок нет"} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="tt-visually-hidden">Заявки учителей: {TABS.find((t) => t.status === status)!.label.toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col">Заявитель</th>
                <th scope="col">Школа и должность</th>
                <th scope="col">Подана</th>
                <th scope="col">{status === "pending" ? <span className="tt-visually-hidden">Решение</span> : "Решение"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id}>
                  <td>
                    <b>{v.applicant.fullName}</b>
                    <span className="table__sub">{v.applicant.email}</span>
                  </td>
                  <td>
                    {v.school.shortNameRu}
                    {v.school.isDemo ? (
                      <>
                        {" "}
                        <Chip tone="violet">демо</Chip>
                      </>
                    ) : null}
                    <span className="table__sub">{v.position}</span>
                  </td>
                  <td className="table__nowrap">{fmt.format(new Date(v.createdAt))}</td>
                  <td>
                    {v.status === "pending" ? (
                      <span className="table__actions">
                        <Button small variant="success" icon={<Check weight="bold" />} loading={busy === v.id} disabled={Boolean(busy)} onClick={() => void approve(v)} aria-label={`Одобрить: ${v.applicant.fullName}`}>
                          Одобрить
                        </Button>
                        <Button
                          small
                          variant="secondary"
                          icon={<X weight="bold" />}
                          disabled={Boolean(busy)}
                          onClick={() => {
                            setReason("");
                            setReasonError(null);
                            setRejectError(null);
                            setRejecting(v);
                          }}
                          aria-label={`Отклонить: ${v.applicant.fullName}`}
                        >
                          Отклонить
                        </Button>
                      </span>
                    ) : (
                      <span>
                        {v.status === "approved" ? <Chip tone="green">Одобрена</Chip> : <Chip tone="coral">Отклонена</Chip>}
                        {v.decisionReason ? <span className="table__sub">{v.decisionReason}</span> : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.hasMore ? (
            <LinkButton loading={list.loadingMore} onClick={() => void more()}>
              Показать ещё
            </LinkButton>
          ) : null}
        </div>
      )}

      <Dialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Отклонить заявку"
        description={rejecting ? `${rejecting.applicant.fullName}, ${rejecting.school.shortNameRu}` : undefined}
      >
        <Form className="tt-stack tt-stack--loose" invalidFocus={invalid} onSubmit={() => void reject()}>
          <TextArea
            label="Причина отказа"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            maxLength={500}
            error={reasonError}
            hint="Её увидит заявитель."
          />
          {rejectError ? <InlineAlert tone="danger">{rejectError}</InlineAlert> : null}
          <Button type="submit" variant="danger" block loading={busy === rejecting?.id}>
            Отклонить заявку
          </Button>
        </Form>
      </Dialog>
    </div>
  );
}
