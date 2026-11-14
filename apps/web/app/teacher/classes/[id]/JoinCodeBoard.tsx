"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowsClockwise, UserPlus } from "@phosphor-icons/react/ssr";
import { CLASS_CODE_TTL_SECONDS } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import { Button, Dialog, InlineAlert } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { msUntil } from "@teletau/session/clock";
import { ApiProblem, describeProblem } from "@teletau/session/problem";
import { ClassTitle } from "../../../_components/screens";
import { SiteQr } from "../../../_components/SiteQr";
import { useT } from "../../../../i18n/client";
import { RequestsBadge } from "./Overview";

/**
 * Код и момент окончания по часам устройства: остаток на момент получения считан по часам сервера (clock.ts).
 * Постоянный код стенда показа (`permanent`) не истекает и не гасится.
 */
type JoinCode = Schema<"JoinCode"> & { deadline: number };

/** Код не удалось погасить: какой и когда он перестанет действовать сам (время сервера, по Уфе). */
export interface CloseFailure {
  display: string;
  expiresAt: string;
}

/**
 * Сколько коду осталось при получении: по часам сервера (поправка по заголовку Date ответов BFF/API), не дольше срока
 * жизни кода. На школьном ПК со сбитыми часами расчёт по Date.now() показал бы свежий код «истёкшим».
 */
function deadlineOf(expiresAt: string): number {
  return Date.now() + Math.max(0, Math.min(msUntil(expiresAt), CLASS_CODE_TTL_SECONDS * 1000));
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Код посимвольно для читалки экрана: «K 7 Q 4 M Z» (дефис — только для глаз). */
const spelled = (display: string) => display.replace(/[^0-9A-Z]/gi, "").split("").join(" ");

const noSubscribe = () => () => undefined;
/**
 * Адрес сайта, на котором открыта доска: учитель показывает её с того же сайта, куда входят ученики (за прокси —
 * тот адрес, что в адресной строке браузера). На сервере — null: доска открывается только в браузере.
 */
function useSite(): { host: string; root: string } | null {
  const host = useSyncExternalStore(noSubscribe, () => window.location.host, () => null);
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => null);
  return host && origin ? { host, root: `${origin}/` } : null;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Код класса на доске: выпуск при открытии доски и гашение на сервере, когда доска закрыта. Код живёт, пока
 * он на доске или пока учитель разбирает заявки, открытые с доски; закрыли доску (кнопкой, Esc, «Назад») или эти
 * заявки — `close()`: DELETE /classes/{id}/join-code. Уже поданные заявки остаются у учителя.
 * Не удалось погасить (сеть, сбой сервера) — доска всё равно закрыта, а `closeFailure` говорит учителю, до какого
 * времени код ещё действует; `retryClose()` — попробовать снова.
 *
 * Порядок запросов: DELETE гасит любой действующий код класса, поэтому выпуск ждёт начатого гашения, а выпуск — один
 * за раз. Код, выпуск которого закончился, когда доска уже закрыта, гасится сразу: на экране его никто не видел.
 */
export function useJoinCode(classId: string) {
  const [code, setCode] = useState<JoinCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closeFailure, setCloseFailure] = useState<CloseFailure | null>(null);
  const codeRef = useRef<JoinCode | null>(null);
  /** Доска открыта (или открыты заявки с доски) — выпущенный код нужен. */
  const live = useRef(false);
  const issuing = useRef(false);
  const killing = useRef<Promise<void> | null>(null);

  const kill = useCallback(
    (gone: Pick<JoinCode, "display" | "expiresAt">) => {
      const run = (async () => {
        try {
          await unwrap(api.DELETE("/api/v1/classes/{id}/join-code", { params: { path: { id: classId } } }));
          setCloseFailure(null);
        } catch (e) {
          // 404 — класса больше нет, а с ним и кода. Остальное — код, возможно, ещё действует.
          if (!(e instanceof ApiProblem && e.status === 404)) setCloseFailure({ display: gone.display, expiresAt: gone.expiresAt });
        }
      })();
      killing.current = run;
      void run.finally(() => {
        if (killing.current === run) killing.current = null;
      });
    },
    [classId],
  );

  /** Выпустить код (открытие доски, «Новый код»). Новый код на сервере заменяет прежний. */
  const issue = useCallback(async () => {
    live.current = true;
    if (issuing.current) return;
    issuing.current = true;
    setBusy(true);
    setError(null);
    try {
      if (killing.current) await killing.current;
      const issued = await unwrap(api.POST("/api/v1/classes/{id}/join-code", { params: { path: { id: classId } } }));
      if (!live.current) {
        if (!issued.permanent) kill(issued);
        return;
      }
      const next = { ...issued, deadline: issued.permanent ? Number.POSITIVE_INFINITY : deadlineOf(issued.expiresAt) };
      codeRef.current = next;
      setCode(next);
      // Прежний код, который не удалось погасить, новый заменил на сервере (контракт createClassJoinCode).
      setCloseFailure(null);
    } catch (e) {
      if (live.current) setError(describeProblem(e));
    } finally {
      issuing.current = false;
      setBusy(false);
    }
  }, [classId, kill]);

  /**
   * Доска закрыта: погасить код на сервере. Код ещё выпускается — его погасит issue(), когда он придёт. Постоянный код
   * не гасится — запрос не нужен (сервер ответил бы 204, а код остался бы).
   */
  const close = useCallback(() => {
    live.current = false;
    const current = codeRef.current;
    codeRef.current = null;
    setCode(null);
    setError(null);
    if (current && !current.permanent) kill(current);
  }, [kill]);

  const retryClose = useCallback(() => {
    if (closeFailure && !live.current) kill(closeFailure);
  }, [closeFailure, kill]);

  // Уход со страницы класса при открытой доске (переход внутри сайта) — код тоже гасится.
  useEffect(
    () => () => {
      if (live.current && codeRef.current && !codeRef.current.permanent) kill(codeRef.current);
    },
    [kill],
  );

  // Срок кода прошёл — сообщение «код ещё действует» больше не нужно.
  useEffect(() => {
    if (!closeFailure) return;
    const t = setTimeout(() => setCloseFailure(null), Math.max(0, msUntil(closeFailure.expiresAt)));
    return () => clearTimeout(t);
  }, [closeFailure]);

  return { code, error, busy, issue, close, closeFailure, retryClose };
}

export type JoinCodeState = ReturnType<typeof useJoinCode>;

/**
 * Код класса на доску: во весь экран, крупно, с таймером (код живёт 15 минут; ADR 0016 §6). Постоянный код стенда
 * показа — без таймера и без «Новый код»: «Код постоянный».
 * Сам код сервер отдаёт один раз — при выпуске; новый код заменяет старый.
 * Рядом — адрес сайта крупно и QR со ссылкой на главную: код класса нужен детям без карточки, а значит без
 * напечатанного адреса. В QR только адрес сайта, секрета в нём нет.
 */
export function JoinCodeBoard({
  open,
  onClose,
  joinCode,
  classTitle,
  pendingRequests,
  onOpenRequests,
}: {
  open: boolean;
  /** Доска закрыта (крестик «Закрыть код класса», Esc, «Назад»): вызывающий гасит код — joinCode.close(). */
  onClose: () => void;
  joinCode: JoinCodeState;
  classTitle: string;
  pendingRequests: number;
  /** «Заявки»: доска сменяется заявками, код продолжает действовать. */
  onOpenRequests: () => void;
}) {
  const { code, error, busy, issue } = joinCode;
  const t = useT();
  const permanent = Boolean(code?.permanent);
  const now = useNow(open && Boolean(code) && !permanent);
  const site = useSite();
  // now обновляется раз в секунду и может быть старше момента получения кода — остаток не больше срока жизни кода.
  const left = code ? Math.min(code.deadline - now, CLASS_CODE_TTL_SECONDS * 1000) : 0;
  const expired = Boolean(code) && !permanent && left <= 0;

  useEffect(() => {
    if (open && (!code || code.deadline <= Date.now())) void issue();
    // Код выпускается при открытии, если действующего нет (зависимость — только открытие).
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="board"
      title={
        <>
          {t("Код класса")} <ClassTitle title={classTitle} />
        </>
      }
      closeLabel={t("Закрыть код класса")}
    >
      <div className="board">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        {/* Для глаз — «K7Q-4MZ», для читалки — скрытый текст посимвольно (aria-label на span без роли не читается). */}
        <p className="board__code" aria-live="polite" aria-atomic="true">
          {code ? (
            <>
              <span className={expired ? "board__code--expired" : undefined} aria-hidden="true">
                {code.display}
              </span>
              <span className="tt-visually-hidden">{spelled(code.display)}</span>
            </>
          ) : (
            <>
              <span aria-hidden="true">···-···</span>
              <span className="tt-visually-hidden">{t("Выпускаем код")}</span>
            </>
          )}
        </p>
        <p className="board__timer">
          {code ? (permanent ? t("Код постоянный") : expired ? t("Код истёк — покажите новый") : t("Действует ещё {time}", { time: mmss(left) })) : t("Выпускаем код…")}
        </p>
        <div className="board__how">
          <ol className="board__steps">
            <li>
              {t("Открой сайт")}
              {site ? (
                <>
                  {" "}
                  <b className="board__site tt-break-anywhere">{site.host}</b>
                </>
              ) : null}{" "}
              {t("и нажми «У меня есть карточка или код»")}
            </li>
            <li>{t("Выбери «Ввести код класса»")}</li>
            <li>{t("Введи код и выбери ник — учитель подтвердит")}</li>
          </ol>
          {site ? (
            <figure className="board__qr">
              <SiteQr url={site.root} label={t("QR-код: ссылка на сайт {host}", { host: site.host })} />
              <figcaption>{t("Наведи камеру телефона — откроется сайт")}</figcaption>
            </figure>
          ) : null}
        </div>
        <div className="board__actions">
          {permanent ? null : (
            <Button variant="secondary" icon={<ArrowsClockwise weight="bold" />} onClick={() => void issue()} loading={busy}>
              {expired ? t("Показать новый код") : t("Новый код")}
            </Button>
          )}
          {/* Пришли заявки — кнопка зелёная: учитель замечает её, не отходя от доски. */}
          <Button variant={pendingRequests ? "success" : "secondary"} icon={<UserPlus weight="fill" />} onClick={onOpenRequests}>
            {t("Заявки на вход")}
            <RequestsBadge count={pendingRequests} />
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
