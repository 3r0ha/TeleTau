"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Dialog, InlineAlert, Skeleton, SkeletonGroup, SpeakButton, useReducedMotion } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { useT } from "../../i18n/client";
import type { T } from "../../i18n/core";
import { localAudio } from "../_components/learn/audio";
import { plural } from "../_components/learn/format";

type Preview = Schema<"LessonPreview">;
type Entry = Schema<"LessonPreviewWord">;

/** Виды заданий словами учителя; незнакомый вид (контракт расширяемый) не показывается. Фабрика от переводчика. */
function taskLabels(t: T): Record<string, string> {
  return {
    choice_ba_ru: t("Выбрать перевод"),
    tiles_ru_ba: t("Собрать фразу"),
    free_ru_ba: t("Написать по-башкирски"),
    match_pairs: t("Найти пары"),
    duel: t("Помочь языку"),
  };
}

const wordsWord = (n: number, t: T) => plural(n, [t("слово"), t("слова"), t("слов")]);
const phrasesWord = (n: number, t: T) => plural(n, [t("фраза"), t("фразы"), t("фраз")]);
const tasksWord = (n: number, t: T) => plural(n, [t("задание"), t("задания"), t("заданий")]);

/** «5 слов · 2 фразы» — что ученик выучит в уроке. */
function previewSummary(p: Preview, t: T): string {
  const parts = [p.words.length ? `${p.words.length} ${wordsWord(p.words.length, t)}` : null, p.phrases.length ? `${p.phrases.length} ${phrasesWord(p.phrases.length, t)}` : null];
  const text = parts.filter(Boolean).join(" · ");
  return text || `${p.exerciseCount} ${tasksWord(p.exerciseCount, t)}`;
}

// Содержимое урока не меняется, пока учитель в кабинете: один запрос на урок, ошибка — не запоминается.
const cache = new Map<string, Promise<Preview>>();
function loadPreview(lessonId: string): Promise<Preview> {
  let pending = cache.get(lessonId);
  if (!pending) {
    pending = unwrap(api.GET("/api/v1/lessons/{lessonId}/preview", { params: { path: { lessonId } } }));
    cache.set(lessonId, pending);
    pending.catch(() => cache.delete(lessonId));
  }
  return pending;
}

/** «Что в уроке» по id узла тропы; пока грузится другой урок — данных нет (не показываем прежний). */
export function useLessonPreview(lessonId: string | null | undefined): { data?: Preview; error?: unknown; reload: () => void } {
  const r = useResource(() => loadPreview(lessonId!), [lessonId], { enabled: Boolean(lessonId) });
  const data = r.data && r.data.lessonId === lessonId ? r.data : undefined;
  return { data, error: data || r.loading ? undefined : r.error, reload: r.reload };
}

function EntryList({ title, entries, headingId, kind }: { title: string; entries: Entry[]; headingId: string; kind: "words" | "phrases" }) {
  const t = useT();
  return (
    <section className="peek__section" aria-labelledby={headingId}>
      <h3 className="peek__label" id={headingId}>
        {title} <span className="peek__count">{entries.length}</span>
      </h3>
      <ul className="peek__words" data-kind={kind}>
        {entries.map((e) => (
          <li key={e.id} className="peek__word">
            <span className="peek__text">
              <b lang="ba">{e.word.text}</b>
              <span>{e.translationRu}</span>
            </span>
            <SpeakButton sources={localAudio(e.word.audio)} size="small" label={t("Послушать: {word}", { word: e.word.text })} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Слова и фразы урока с переводом и «Послушать», ниже — виды заданий. */
export function LessonContents({ preview: p }: { preview: Preview }) {
  const t = useT();
  const id = useId();
  const tasks = p.tasks.filter((task) => taskLabels(t)[task.type]);
  return (
    <div className="peek__body">
      {p.words.length ? <EntryList title={p.kind === "lesson" ? t("Новые слова") : t("Слова")} entries={p.words} headingId={`${id}-words`} kind="words" /> : null}
      {p.phrases.length ? <EntryList title={t("Фразы")} entries={p.phrases} headingId={`${id}-phrases`} kind="phrases" /> : null}
      {tasks.length ? (
        <section className="peek__section" aria-labelledby={`${id}-tasks`}>
          <h3 className="peek__label" id={`${id}-tasks`}>
            {t("Задания")} <span className="peek__count">{p.exerciseCount}</span>
          </h3>
          <ul className="peek__tasks">
            {tasks.map((task) => (
              <li key={task.type} className="peek__task">
                {taskLabels(t)[task.type]}
                {task.count > 1 ? (
                  <>
                    {" "}
                    <span className="peek__times">{task.count}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Loading() {
  const t = useT();
  return (
    <SkeletonGroup label={t("Загружаем урок")} className="peek__body">
      <Skeleton width="30%" height={14} />
      <Skeleton height={56} radius="card" />
      <Skeleton height={56} radius="card" />
    </SkeletonGroup>
  );
}

function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="peek__failed" aria-live="polite">
      <InlineAlert tone="danger">{describeProblem(error)}</InlineAlert>
      <Button variant="secondary" small onClick={onRetry}>
        {t("Повторить")}
      </Button>
    </div>
  );
}

function PreviewState({ lessonId, children }: { lessonId: string; children: (p: Preview) => ReactNode }) {
  const { data, error, reload } = useLessonPreview(lessonId);
  if (data) return <>{children(data)}</>;
  if (error) return <Failed error={error} onRetry={reload} />;
  return <Loading />;
}

/**
 * «Что в уроке» в листе «Задание классу»: свёрнуто — одна строка со счётом слов, развёрнуто — слова, фразы и задания.
 * Раскрытие сохраняется, пока учитель перебирает уроки; раскрытое содержимое прокручивается в лист, под заголовок.
 */
export function LessonPeek({ lessonId, test }: { lessonId: string; test?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { data } = useLessonPreview(lessonId);
  const bodyId = useId();
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (open) box.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [open, reduced]);
  return (
    <div className="peek" data-open={open || undefined} ref={box}>
      <button type="button" className="peek__head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <span className="peek__head-title">{test ? t("Что внутри") : t("Что в уроке")}</span>
        {data ? <span className="peek__head-sum">{previewSummary(data, t)}</span> : null}
        <CaretDown weight="bold" className="peek__caret" aria-hidden />
      </button>
      <div id={bodyId} hidden={!open} className="peek__panel">
        {open ? <PreviewState lessonId={lessonId}>{(p) => <LessonContents preview={p} />}</PreviewState> : null}
      </div>
    </div>
  );
}

export interface PreviewTarget {
  lessonId: string;
  titleRu: string;
  /** Строка под заголовком: место и сколько прошли. */
  sub?: string;
}

/** «Что в уроке» отдельным листом — из «Прогресса»: название урока и строка под ним, ниже — содержимое. */
export function LessonPreviewDialog({ lesson, onClose }: { lesson: PreviewTarget | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(lesson)} onClose={onClose} title={lesson?.titleRu ?? ""} description={lesson?.sub} wide>
      {lesson ? <PreviewState lessonId={lesson.lessonId}>{(p) => <LessonContents preview={p} />}</PreviewState> : null}
    </Dialog>
  );
}
