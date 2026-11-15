"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cards, DownloadSimple, FileText, ProjectorScreen } from "@phosphor-icons/react/ssr";
import { Button, InlineAlert, LinkButton, Skeleton, SkeletonGroup, useToast } from "@teletau/ui";
import { api, downloadFile, unwrap } from "@teletau/session/api";
import { serverNow } from "@teletau/session/clock";
import { ApiProblem, describeProblem, isNetworkError } from "@teletau/session/problem";
import { useOnline, useResource } from "@teletau/session/react";
import { LoadError, isForbidden, isNotFound, useDocumentTitle } from "../../../_components/screens";
import { useT } from "../../../../i18n/client";
import { TeacherShell } from "../../TeacherShell";
import { useTeacherGate } from "../../useTeacher";
import { BackToClasses, ClassHeader, ClassTabs, ClassUnavailable } from "./ClassFrame";
import { IssueCardsDialog } from "./IssueCardsDialog";
import { JoinCodeBoard, useJoinCode } from "./JoinCodeBoard";
import { JoinRequestsDialog } from "./JoinRequestsDialog";
import { RequestsBanner, SetupSteps, TodayCards } from "./Overview";
import { SeatDialog } from "./SeatDialog";
import { SeatGrid } from "./SeatGrid";
import { forgetPrintJob, isUuid, loadPrintJob, pdfName, printJobLive, savePrintJob, seatLabel, seatRange, time, type PrintJob, type Seat } from "./format";
import { studentRows, ufaToday } from "./progress/model";

/** Опрос класса: новые ученики появляются без перезагрузки не позже чем через 5 с (критерий приёмки 3). */
const POLL_MS = 3000;
/** Прогресс и задания меняются, пока дети занимаются: свежие цифры без перезагрузки. */
const PROGRESS_POLL_MS = 10_000;
const TASKS_POLL_MS = 15_000;

/**
 * Страница класса, раздел «Обзор». Пока учеников нет — три шага к первому уроку (карточки, код на доске). Когда ученики
 * есть — сверху главное: кто занимался сегодня, кто на неделе не открывал уроки, как идёт задание; новые заявки на вход —
 * баннером сразу под заголовком (отдельной кнопки «Заявки на вход» нет: без заявок она не нужна, а с доски они открываются
 * своей кнопкой). Ниже — места (ник, чем занят, карточка, согласие) с выпуском карточек и PDF; пока мест нет, раздела нет.
 * Чужой класс — «Нет доступа» (403). Раздел «Прогресс» — progress/page.tsx, «Задания» — assignments/page.tsx.
 * С главной кабинета: `?open=requests` («Посмотреть» у заявок) сразу открывает «Заявки на вход», `?open=board` — код на
 * доске, `?open=cards` — выпуск карточек.
 */
export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { me } = useTeacherGate("verified");
  const t = useT();
  const toast = useToast();
  const online = useOnline();
  // Битый идентификатор в адресе — сразу «Класс не найден», без запроса (иначе — текст валидатора API).
  const validId = isUuid(id);
  const enabled = Boolean(me) && validId;
  const klass = useResource(() => unwrap(api.GET("/api/v1/classes/{id}", { params: { path: { id } } })), [id], { enabled, pollMs: POLL_MS });
  const students = (klass.data?.seats ?? []).filter((s) => s.student).length;
  const working = students > 0;
  const progress = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/progress", { params: { path: { id } } })), [id], {
    enabled: enabled && working,
    pollMs: PROGRESS_POLL_MS,
  });
  const tasks = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/assignments", { params: { path: { id } } })), [id], {
    enabled: enabled && working,
    pollMs: TASKS_POLL_MS,
  });
  const pendingRequests = klass.data?.pendingJoinRequestCount ?? 0;
  // Ники в баннере заявок — те же заявки, что в листе «Заявки на вход».
  const requestList = useResource(
    () => unwrap(api.GET("/api/v1/classes/{id}/join-requests", { params: { path: { id }, query: { status: "pending" } } })),
    [id, pendingRequests],
    { enabled: enabled && pendingRequests > 0, keepPrevious: true },
  );
  useDocumentTitle(klass.data?.title);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [board, setBoard] = useState(false);
  const [requests, setRequests] = useState(false);
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const known = useRef<Map<number, string> | null>(null);
  // Код класса живёт, пока он на доске или учитель разбирает заявки с доски; закрыли — гасится на сервере.
  const joinCode = useJoinCode(id);

  useEffect(() => setPrintJob(loadPrintJob(id)), [id]);

  // Пришли с главной по кнопке действия — нужный лист открывается, как только загрузился класс (один раз).
  const asked = useRef(params.get("open"));
  useEffect(() => {
    if (!asked.current || !klass.data) return;
    const what = asked.current;
    asked.current = null;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (what === "requests" && (klass.data.pendingJoinRequestCount ?? 0) > 0) setRequests(true);
    if (what === "board") setBoard(true);
    if (what === "cards") setIssuing(true);
  }, [klass.data]);

  // Подсветка новых учеников гаснет через 15 с; таймеры снимаются при уходе со страницы.
  const freshTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = freshTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Новый ученик на месте — подсветка плитки и тост (только после первой загрузки).
  useEffect(() => {
    const seats = klass.data?.seats;
    if (!seats) return;
    const now = new Map(seats.filter((s) => s.student).map((s) => [s.number, s.student!.accountId]));
    if (known.current) {
      const joined = seats.filter((s) => s.student && known.current!.get(s.number) !== s.student.accountId);
      if (joined.length) {
        setFresh((prev) => new Set([...prev, ...joined.map((s) => s.number)]));
        for (const s of joined.slice(0, 3)) toast(t("{seat} · {nick} — в классе", { seat: seatLabel(s.number), nick: s.student!.nickname ?? t("новый ученик") }), "info");
        const timer = setTimeout(() => {
          freshTimers.current.delete(timer);
          setFresh((prev) => new Set([...prev].filter((n) => !joined.some((s) => s.number === n))));
        }, 15_000);
        freshTimers.current.add(timer);
      }
    }
    known.current = now;
  }, [klass.data, toast, t]);

  const seatProgress = useMemo(() => new Map((progress.data?.seats ?? []).map((p) => [p.seatNumber, p])), [progress.data]);

  const rememberJob = (job: PrintJob) => {
    savePrintJob(id, job);
    setPrintJob(job);
  };

  /** Скачать PDF карточек. Ответ — текст ошибки или null: листы показывают итог у кнопки (тост под затемнением не виден). */
  const download = async (job: PrintJob | null = printJob): Promise<string | null> => {
    if (!job || !klass.data) return null;
    setDownloading(true);
    try {
      await downloadFile(job.pdfPath, pdfName(klass.data.title));
      return null;
    } catch (e) {
      const message = describeProblem(e, "adult", t);
      toast(message, "error");
      // Файл устарел или заменён — задание печати забывается и во вкладке, и в sessionStorage (после перезагрузки
      // кнопка «Скачать PDF» не вернётся).
      if (!isNetworkError(e)) {
        forgetPrintJob(id);
        setPrintJob(null);
      }
      return message;
    } finally {
      setDownloading(false);
    }
  };

  const missing = !validId || (klass.error && !klass.data && (isNotFound(klass.error) || (klass.error instanceof ApiProblem && klass.error.status === 422)));
  if (missing || (klass.error && !klass.data)) {
    const forbidden = !missing && isForbidden(klass.error);
    return (
      <TeacherShell>
        {missing || forbidden ? (
          <ClassUnavailable forbidden={forbidden} />
        ) : (
          <LoadError error={klass.error} onRetry={klass.reload} home="/teacher" />
        )}
      </TeacherShell>
    );
  }

  const c = klass.data;
  const seats: Seat[] = c?.seats ?? [];
  const job = printJobLive(printJob) ? printJob : null;
  const nextSeat = seats.reduce((m, s) => Math.max(m, s.number), 0) + 1;
  const today = ufaToday(serverNow());
  const consents = seats.filter((s) => s.consent?.status === "given").length;
  const rows = c && progress.data ? studentRows(seats, progress.data.seats) : null;

  // Когда ученики уже есть, код на доску — в заголовке класса: с него начинается урок.
  const lessonActions = working ? (
    <Button icon={<ProjectorScreen weight="fill" />} onClick={() => setBoard(true)}>
      {t("Показать код класса")}
    </Button>
  ) : undefined;

  return (
    <TeacherShell>
      <div className="tt-stack tt-stack--loose class-page">
        <BackToClasses />

        {!c ? (
          <SkeletonGroup label={t("Загружаем класс")} className="tt-stack">
            <Skeleton width="40%" height={34} />
            <Skeleton width="70%" height={18} />
            <div className="today">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={180} radius="card" />
              ))}
            </div>
            <div className="seat-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} height={84} radius="panel" />
              ))}
            </div>
          </SkeletonGroup>
        ) : (
          <>
            <ClassHeader c={c} actions={lessonActions} />
            <ClassTabs id={c.id} current="seats" />

            <div aria-live="polite" className="tt-stack tt-stack--tight class-page__alerts">
              {joinCode.closeFailure ? (
                <InlineAlert tone="danger">
                  {t("Не удалось закрыть код класса {code}. Он сам перестанет действовать в {time}.", {
                    code: joinCode.closeFailure.display,
                    time: time(joinCode.closeFailure.expiresAt),
                  })}{" "}
                  <LinkButton onClick={joinCode.retryClose}>{t("Закрыть код ещё раз")}</LinkButton>
                </InlineAlert>
              ) : null}
              {!online || (klass.error && isNetworkError(klass.error)) ? (
                <InlineAlert tone="honey">{t("Нет связи. Список обновится, когда сеть вернётся.")}</InlineAlert>
              ) : klass.error ? (
                <InlineAlert tone="danger">{describeProblem(klass.error, "adult", t)}</InlineAlert>
              ) : null}
            </div>

            <RequestsBanner count={pendingRequests} names={(requestList.data?.items ?? []).map((r) => r.nickname)} onOpen={() => setRequests(true)} />

            {working ? (
              <TodayCards
                classId={c.id}
                rows={rows}
                today={today}
                tasks={tasks.data ?? null}
                progressError={Boolean(progress.error) && !progress.data}
                tasksError={Boolean(tasks.error) && !tasks.data}
                onRetry={() => {
                  progress.reload();
                  tasks.reload();
                }}
              />
            ) : (
              <SetupSteps
                seatsCount={seats.length}
                seatNumbers={seats.map((s) => s.number)}
                job={job}
                downloading={downloading}
                onIssue={() => setIssuing(true)}
                onDownload={() => void download()}
                onBoard={() => setBoard(true)}
              />
            )}

            {seats.length ? (
              <section aria-labelledby="seats-title" className="tt-stack seats-section">
                <header className="section-head">
                  <div className="tt-stack tt-stack--tight">
                    <h2 id="seats-title" className="tt-title3">
                      {t("Места")}
                    </h2>
                    <p className="tt-muted section-head__sub">
                      <span className="section-head__legend">
                        <FileText weight="fill" aria-hidden /> {t("согласие родителей: {done} из {total}", { done: consents, total: seats.length })}
                      </span>
                    </p>
                  </div>
                  {working ? (
                    <div className="section-head__actions" role="group" aria-label={t("Карточки")}>
                      {job ? (
                        <Button small icon={<DownloadSimple weight="bold" />} onClick={() => void download()} loading={downloading} aria-describedby="pdf-note">
                          {t("Скачать PDF")}
                        </Button>
                      ) : null}
                      <Button small variant="secondary" icon={<Cards weight="fill" />} onClick={() => setIssuing(true)}>
                        {t("Выпустить карточки")}
                      </Button>
                    </div>
                  ) : null}
                </header>
                {working && job ? (
                  <p className="tt-muted" id="pdf-note">
                    {t("PDF {seats} доступен до {time}.", { seats: seatRange(job.seatNumbers), time: time(job.expiresAt) })}
                  </p>
                ) : null}
                <SeatGrid seats={seats} fresh={fresh} onOpen={setOpenSeat} progress={progress.data ? seatProgress : undefined} today={today} />
              </section>
            ) : null}
          </>
        )}
      </div>

      {c ? (
        <>
          <IssueCardsDialog
            open={issuing}
            onClose={() => setIssuing(false)}
            classId={c.id}
            nextSeat={nextSeat}
            freeCapacity={99 - seats.length}
            onIssued={(issued) => {
              rememberJob(issued);
              klass.reload();
            }}
            onDownload={(j) => download(j)}
            downloading={downloading}
          />
          <JoinCodeBoard
            open={board}
            onClose={() => {
              setBoard(false);
              joinCode.close();
            }}
            joinCode={joinCode}
            classTitle={c.title}
            pendingRequests={pendingRequests}
            onOpenRequests={() => {
              setBoard(false);
              setRequests(true);
            }}
          />
          <JoinRequestsDialog
            open={requests}
            onClose={() => {
              setRequests(false);
              // Заявки, открытые с доски, закрыты — код больше не на экране (без кода — ничего не делает).
              joinCode.close();
            }}
            classId={c.id}
            onChanged={() => {
              klass.reload();
              requestList.reload();
            }}
            onShowCode={() => {
              setRequests(false);
              setBoard(true);
            }}
          />
          <SeatDialog
            seat={seats.find((s) => s.number === openSeat) ?? null}
            classId={c.id}
            onClose={() => setOpenSeat(null)}
            onChanged={klass.reload}
            onReissued={(j) => rememberJob(j)}
            onDownload={(j) => void download(j)}
            downloading={downloading}
          />
        </>
      ) : null}
    </TeacherShell>
  );
}
