"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, DownloadSimple } from "@phosphor-icons/react/ssr";
import { Button, Dialog, Form, InlineAlert, TextField, useInvalidFocus } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem, fieldErrors } from "@teletau/session/problem";
import { cardsWord, seatRange, time, type PrintJob } from "./format";
import { uuidv7 } from "../../../_components/learn/ids";

const MAX_PER_ISSUE = 40;

/**
 * Выпуск N карточек (POST /classes/{id}/seats). Секреты карточек в ответ не приходят — только задание печати:
 * PDF по нему можно скачать 30 минут (ADR 0016 §4).
 */
export function IssueCardsDialog({
  open,
  onClose,
  classId,
  nextSeat,
  freeCapacity,
  onIssued,
  onDownload,
  downloading,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  nextSeat: number;
  freeCapacity: number;
  onIssued: (job: PrintJob) => void;
  /** Скачать PDF: текст ошибки или null. */
  onDownload: (job: PrintJob) => Promise<string | null>;
  downloading: boolean;
}) {
  const max = Math.max(0, Math.min(MAX_PER_ISSUE, freeCapacity));
  const [count, setCount] = useState("24");
  const [error, setError] = useState<string | null>(null);
  // Сбой сервера или сети — не ошибка числа: сообщение role="alert", поле без aria-invalid.
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<PrintJob | null>(null);
  // Итог скачивания — в листе: тост под затемнением листа почти не виден.
  const [saved, setSaved] = useState<"ok" | string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef(uuidv7());
  const invalid = useInvalidFocus();

  useEffect(() => {
    if (open) {
      setJob(null);
      setSaved(null);
      setError(null);
      setFormError(null);
      setCount(String(Math.min(24, max) || 1));
    }
  }, [open, max]);

  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= max;

  const submit = async () => {
    if (!valid) {
      setError(max === 0 ? "В классе уже 99 мест — больше выпустить нельзя." : `Введите число от 1 до ${max}.`);
      invalid.request();
      return;
    }
    setBusy(true);
    setError(null);
    setFormError(null);
    try {
      const res = await unwrap(
        api.POST("/api/v1/classes/{id}/seats", {
          params: { path: { id: classId }, header: { "Idempotency-Key": idempotencyKey.current } },
          body: { count: n },
        }),
      );
      idempotencyKey.current = uuidv7();
      setJob(res.printJob);
      onIssued(res.printJob);
    } catch (e) {
      // Число отклонил сервер (422 /count) — ошибка у поля, фокус туда же, чтобы читалка её прочитала.
      // Остальное — сообщением; фокус остаётся на кнопке.
      const countProblem = fieldErrors(e).count;
      if (countProblem) {
        setError(countProblem);
        invalid.request();
      } else setFormError(describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (j: PrintJob) => setSaved((await onDownload(j)) ?? "ok");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={job ? "Карточки готовы" : "Выпустить карточки"}
      description={job ? undefined : "По одной на ученика."}
      initialFocusRef={inputRef}
    >
      {job ? (
        <div className="tt-stack" aria-live="polite">
          <InlineAlert tone="success">
            Выпущено {job.seatNumbers.length} {cardsWord(job.seatNumbers.length)}: {seatRange(job.seatNumbers)}.
          </InlineAlert>
          {saved === "ok" ? (
            <p className="issue-saved">
              <CheckCircle weight="fill" aria-hidden /> PDF скачан. Распечатайте и раздайте карточки.
            </p>
          ) : saved ? (
            <InlineAlert tone="danger">{saved}</InlineAlert>
          ) : (
            <p className="tt-muted">PDF можно скачать до {time(job.expiresAt)}.</p>
          )}
          <div className="tt-dialog__actions">
            {saved === "ok" ? (
              <>
                <Button block onClick={onClose}>
                  Готово
                </Button>
                <Button block variant="secondary" icon={<DownloadSimple weight="bold" />} loading={downloading} onClick={() => void save(job)}>
                  Скачать ещё раз
                </Button>
              </>
            ) : (
              <Button block icon={<DownloadSimple weight="bold" />} loading={downloading} onClick={() => void save(job)}>
                Скачать PDF
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Form className="tt-stack tt-stack--loose" invalidFocus={invalid} onSubmit={() => void submit()}>
          <TextField
            ref={inputRef}
            label="Сколько карточек"
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={count}
            onChange={(e) => {
              setCount(e.target.value);
              setError(null);
            }}
            error={error}
            hint={valid ? `Номера мест: ${seatRange(Array.from({ length: n }, (_, i) => nextSeat + i))}` : `От 1 до ${max} за раз`}
          />
          {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
          <Button type="submit" block loading={busy} disabled={max === 0}>
            {valid ? `Выпустить ${n} ${cardsWord(n)}` : "Выпустить карточки"}
          </Button>
          {nextSeat > 1 ? <p className="tt-muted">Старые карточки продолжат работать.</p> : null}
        </Form>
      )}
    </Dialog>
  );
}
