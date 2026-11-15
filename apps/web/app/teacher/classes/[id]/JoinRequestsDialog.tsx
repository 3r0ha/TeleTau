"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ProjectorScreen, X } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Dialog, EmptyState, HexAvatar, InlineAlert, Skeleton, SkeletonGroup, avatarFor, toneFor, useFocusRescue, useToast } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { seatLabel, time } from "./format";
import { useT } from "../../../../i18n/client";

type JoinRequest = Schema<"JoinRequest">;
/** Решение учителя по заявке в этом листе: заявка остаётся в списке с итогом, а не пропадает. */
type Decision = { approved: boolean; seatNumber?: number };

/**
 * Заявки на вход по коду класса: одобрить (ученику выдаётся новое место) или отклонить. Опрос раз в 3 с.
 * Решённая заявка остаётся на своём месте в списке с итогом («В классе · №25», «Отклонена»): тост под затемнением листа
 * почти не виден, а учителю важно увидеть, что нажатие сработало. Все решены — «Готово» и «Показать код класса».
 */
export function JoinRequestsDialog({
  open,
  onClose,
  classId,
  onChanged,
  onShowCode,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  onChanged: () => void;
  onShowCode: () => void;
}) {
  const toast = useToast();
  const t = useT();
  // Заявка в работе и какое решение по ней отправлено: индикатор — на нажатой кнопке.
  const [busy, setBusy] = useState<{ id: string; approve: boolean } | null>(null);
  // Решённая строка заменяется итогом — фокус переходит на кнопки следующей заявки или «Готово».
  const body = useRef<HTMLDivElement>(null);
  useFocusRescue(body);
  const [decided, setDecided] = useState<ReadonlyMap<string, Decision>>(new Map());
  // Порядок заявок, увиденных за это открытие листа: решённая заявка не прыгает в начало или конец списка.
  const seen = useRef(new Map<string, JoinRequest>());
  const list = useResource(
    () => unwrap(api.GET("/api/v1/classes/{id}/join-requests", { params: { path: { id: classId }, query: { status: "pending" } } })),
    [classId],
    { enabled: open, pollMs: 3000 },
  );

  useEffect(() => {
    if (!open) return;
    seen.current = new Map();
    setDecided(new Map());
  }, [open]);

  const pending = list.data?.items ?? [];
  for (const r of pending) if (!seen.current.has(r.id)) seen.current.set(r.id, r);
  const live = new Set(pending.map((r) => r.id));
  const rows = [...seen.current.values()].filter((r) => live.has(r.id) || decided.has(r.id));
  const waiting = rows.filter((r) => !decided.has(r.id)).length;

  const decide = async (r: JoinRequest, approve: boolean) => {
    setBusy({ id: r.id, approve });
    try {
      const params = { params: { path: { id: classId, rid: r.id } } };
      const res = approve
        ? await unwrap(api.POST("/api/v1/classes/{id}/join-requests/{rid}/approve", params))
        : await unwrap(api.POST("/api/v1/classes/{id}/join-requests/{rid}/reject", params));
      setDecided((prev) => new Map(prev).set(r.id, { approved: approve, ...(res.seatNumber ? { seatNumber: res.seatNumber } : {}) }));
      // Тост остаётся и после закрытия листа: учитель видит итог на странице класса.
      toast(
        approve
          ? res.seatNumber
            ? t("{nick} — в классе, место {seat}", { nick: res.nickname, seat: seatLabel(res.seatNumber) })
            : t("{nick} — в классе", { nick: res.nickname })
          : t("Заявка «{nick}» отклонена", { nick: res.nickname }),
        approve ? "success" : "info",
      );
      list.setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== r.id) } : d));
      onChanged();
    } catch (e) {
      toast(describeProblem(e, "adult", t), "error");
      list.reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("Заявки на вход")} description={rows.length ? t("Примите тех, кто у вас на уроке.") : undefined} wide>
      {list.error && !list.data ? (
        <InlineAlert tone="danger">{describeProblem(list.error, "adult", t)}</InlineAlert>
      ) : !list.data ? (
        <SkeletonGroup label={t("Загружаем заявки")} className="tt-stack tt-stack--tight">
          {[0, 1].map((i) => (
            <Skeleton key={i} height={64} radius="panel" />
          ))}
        </SkeletonGroup>
      ) : rows.length === 0 ? (
        <EmptyState
          art="emptyAllDone"
          headingAs="h3"
          compact
          title={t("Заявок нет")}
          actions={
            <Button variant="secondary" block icon={<ProjectorScreen weight="fill" />} onClick={onShowCode}>
              {t("Показать код класса")}
            </Button>
          }
        >
          {t("Новые появятся здесь сами.")}
        </EmptyState>
      ) : (
        <div className="tt-stack" ref={body}>
          <ul className="requests" aria-live="polite">
            {rows.map((r) => {
              const d = decided.get(r.id);
              return (
                <li key={r.id} className="request" data-decided={d ? true : undefined}>
                  <HexAvatar size={40} tone={toneFor(r.nickname)} art={avatarFor(r.nickname)} />
                  <span className="request__body">
                    <b>{r.nickname}</b>
                    <span className="tt-muted">{t("в {time}", { time: time(r.createdAt) })}</span>
                  </span>
                  {d ? (
                    <span className="request__done" data-tone={d.approved ? "approved" : "rejected"}>
                      {d.approved ? <Check weight="bold" aria-hidden /> : <X weight="bold" aria-hidden />}
                      {d.approved ? (d.seatNumber ? t("В классе · {seat}", { seat: seatLabel(d.seatNumber) }) : t("В классе")) : t("Отклонена")}
                    </span>
                  ) : (
                    <span className="request__actions">
                      <Button small variant="success" icon={<Check weight="bold" />} loading={busy?.id === r.id && busy.approve} disabled={Boolean(busy)} onClick={() => void decide(r, true)} aria-label={t("Принять: {nick}", { nick: r.nickname })}>
                        {t("Принять")}
                      </Button>
                      <Button small variant="secondary" icon={<X weight="bold" />} loading={busy?.id === r.id && !busy.approve} disabled={Boolean(busy)} onClick={() => void decide(r, false)} aria-label={t("Отклонить: {nick}", { nick: r.nickname })}>
                        {t("Отклонить")}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {waiting === 0 ? (
            <div className="tt-dialog__actions">
              <Button block onClick={onClose}>
                {t("Готово")}
              </Button>
              <Button block variant="secondary" icon={<ProjectorScreen weight="fill" />} onClick={onShowCode}>
                {t("Показать код класса")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
