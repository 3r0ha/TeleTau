"use client";

import { useEffect, useState } from "react";
import { ArrowsClockwise, Cards, ChartBar, DownloadSimple, FileText } from "@phosphor-icons/react/ssr";
import { Button, ButtonLink, Chip, Dialog, HexAvatar, InlineAlert, LinkButton, avatarFor, toneFor, useToast } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem } from "@teletau/session/problem";
import { date, seatLabel, seatNo, time, type PrintJob, type Seat } from "./format";
import { useT } from "../../../../i18n/client";

type Confirm = "reissue" | "revoke" | null;

/**
 * Действия с местом: выпуск или перевыпуск карточки, бумажное согласие родителя (отметить / отозвать).
 * Место без карточки (ученик вошёл по коду класса) — «Выпустить карточку»: API и в этом случае завершает сессии ученика
 * на всех устройствах, дальше он входит по карточке. Предупреждение — одной строкой: что изменится для ученика.
 */
export function SeatDialog({
  seat,
  classId,
  onClose,
  onChanged,
  onReissued,
  onDownload,
  downloading,
}: {
  seat: Seat | null;
  classId: string;
  onClose: () => void;
  onChanged: () => void;
  onReissued: (job: PrintJob) => void;
  onDownload: (job: PrintJob) => void;
  downloading: boolean;
}) {
  const toast = useToast();
  const t = useT();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Выпущенный файл и была ли это первая карточка места (после обновления класса место уже «с карточкой»).
  const [newJob, setNewJob] = useState<{ job: PrintJob; first: boolean } | null>(null);
  const number = seat?.number;

  useEffect(() => {
    setConfirm(null);
    setError(null);
    setNewJob(null);
  }, [number]);

  if (!seat) return <Dialog open={false} onClose={onClose} title="" />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  // Карточки у места ещё не было (вход по коду класса): первая карточка, а не замена старой.
  const firstCard = seat.cardStatus === "none";
  const cardAction = firstCard ? t("Выпустить карточку") : t("Перевыпустить карточку");

  const reissue = () =>
    run(async () => {
      const res = await unwrap(api.POST("/api/v1/classes/{id}/seats/{seat}/reissue", { params: { path: { id: classId, seat: seat.number } } }));
      setNewJob({ job: res.printJob, first: firstCard });
      setConfirm(null);
      onReissued(res.printJob);
      toast(firstCard ? t("Карточка {seat} выпущена", { seat: seatLabel(seat.number) }) : t("Карточка {seat} перевыпущена", { seat: seatLabel(seat.number) }));
    });

  const markConsent = () =>
    run(async () => {
      await unwrap(api.POST("/api/v1/classes/{id}/seats/{seat}/paper-consent", { params: { path: { id: classId, seat: seat.number } }, body: {} }));
      toast(t("Согласие {seat} отмечено", { seat: seatLabel(seat.number) }));
    });

  // Отзыв согласия закрывает вход на место — и по карточке, и по коду класса — и завершает все сессии ученика
  // (consent.service: revokeAllSessions). Текст говорит об этом для любого места, с карточкой или без.
  const revokeConsent = () =>
    run(async () => {
      if (!seat.consent) return;
      await unwrap(api.POST("/api/v1/consents/{id}/revoke", { params: { path: { id: seat.consent.consentId } } }));
      setConfirm(null);
      toast(t("Согласие {seat} отозвано", { seat: seatLabel(seat.number) }), "info");
    });

  const consentGiven = seat.consent?.status === "given";

  return (
    <Dialog open onClose={onClose} title={t("Место {n}", { n: seatLabel(seat.number) })}>
      <div className="tt-stack">
        <div className="seat-head">
          <HexAvatar size={56} tone={seat.student ? toneFor(seat.student.accountId) : "empty"} lip={Boolean(seat.student)} art={avatarFor(seat.student?.nickname)}>
            {seatNo(seat.number)}
          </HexAvatar>
          <div className="tt-stack tt-stack--tight">
            <p className="tt-headline">{seat.student ? (seat.student.nickname ?? t("Ник ещё не выбран")) : t("Ученик ещё не вошёл")}</p>
            {seat.student ? <p className="tt-muted">{t("В классе с {date}", { date: date(seat.student.joinedAt) })}</p> : null}
          </div>
          {seat.student ? (
            // Переход из открытого листа — replace: «Назад» с карточки ученика ведёт на страницу класса (sheetHistory.ts).
            <ButtonLink href={`/teacher/classes/${classId}/seats/${seat.number}`} replace variant="secondary" small icon={<ChartBar weight="fill" aria-hidden />} className="seat-head__go">
              {t("Прогресс")}
            </ButtonLink>
          ) : null}
        </div>
        <dl className="facts-list">
          <div>
            <dt>{t("Карточка")}</dt>
            <dd>
              {seat.cardStatus === "active" ? (
                <Chip tone="green">{seat.cardVersion > 1 ? t("Действует · выпуск {n}", { n: seat.cardVersion }) : t("Действует")}</Chip>
              ) : seat.cardStatus === "revoked" ? (
                <Chip tone="coral">{t("Отозвана")}</Chip>
              ) : (
                <Chip tone="neutral">{t("Нет, вход по коду")}</Chip>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Согласие родителя")}</dt>
            <dd>
              {seat.consent ? (
                consentGiven ? (
                  <Chip tone="water">{t("Есть, {date}", { date: date(seat.consent.givenAt) })}</Chip>
                ) : (
                  <Chip tone="coral">{seat.consent.revokedAt ? t("Отозвано {date}", { date: date(seat.consent.revokedAt) }) : t("Отозвано")}</Chip>
                )
              ) : (
                <Chip tone="neutral">{t("Не отмечено")}</Chip>
              )}
            </dd>
          </div>
        </dl>

        {newJob ? (
          <InlineAlert tone="success">{t("PDF доступен до {time}.", { time: time(newJob.job.expiresAt) })}</InlineAlert>
        ) : null}
        {confirm === "reissue" && (!firstCard || seat.student) ? (
          <InlineAlert tone="honey">
            {firstCard ? null : <>{t("Старая карточка перестанет работать.")}{" "}</>}
            {seat.student ? (
              <>
                <b>{t("Ученик выйдет на всех устройствах")}</b>, {t("прогресс сохранится.")}
              </>
            ) : null}
          </InlineAlert>
        ) : null}
        {confirm === "revoke" ? (
          <InlineAlert tone="danger">
            {t("Вход на место будет закрыт")}
            {seat.student ? <>, <b>{t("ученик выйдет на всех устройствах")}</b></> : null}.
          </InlineAlert>
        ) : null}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

        <div className="tt-dialog__actions">
          {newJob ? (
            <Button block icon={<DownloadSimple weight="bold" />} loading={downloading} onClick={() => onDownload(newJob.job)}>
              {t("Скачать PDF")}
            </Button>
          ) : null}
          {confirm === "reissue" ? (
            <>
              <Button block variant="danger" loading={busy} onClick={() => void reissue()}>
                {cardAction}
              </Button>
              <LinkButton tone="neutral" onClick={() => setConfirm(null)}>
                {t("Отмена")}
              </LinkButton>
            </>
          ) : confirm === "revoke" ? (
            <>
              <Button block variant="danger" loading={busy} onClick={() => void revokeConsent()}>
                {t("Отозвать согласие")}
              </Button>
              <LinkButton tone="neutral" onClick={() => setConfirm(null)}>
                {t("Отмена")}
              </LinkButton>
            </>
          ) : (
            <>
              <Button block variant="secondary" icon={firstCard ? <Cards weight="fill" /> : <ArrowsClockwise weight="bold" />} onClick={() => setConfirm("reissue")} disabled={busy}>
                {cardAction}
              </Button>
              {!consentGiven ? (
                <Button block variant="secondary" icon={<FileText weight="fill" />} loading={busy} onClick={() => void markConsent()}>
                  {t("Отметить согласие родителя")}
                </Button>
              ) : (
                <LinkButton tone="danger" onClick={() => setConfirm("revoke")} disabled={busy}>
                  {t("Отозвать согласие")}
                </LinkButton>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
