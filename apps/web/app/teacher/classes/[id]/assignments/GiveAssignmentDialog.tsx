"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Schema } from "@teletau/contracts";
import { Button, ChoiceGroup, Dialog, Form, InlineAlert, useToast } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem, fieldErrors } from "@teletau/session/problem";
import { addDays, assignmentTitle, dueLong, nextFriday, type AssignmentKind } from "../../../../_components/assignments";
import { uuidv7 } from "../../../../_components/learn/ids";
import { LessonPeek } from "../../../LessonPreview";

type Option = Schema<"AssignmentOption">;

const KIND_LABEL: Record<AssignmentKind, string> = { lesson: "Урок", place_test: "Испытание места", review: "Повторить слова" };

/** Сроки на выбор: сегодня, завтра, до пятницы, через неделю, через две — без повторов. */
function dueChoices(today: string): { value: string; label: string; description: string }[] {
  const raw = [
    { value: today, label: "Сегодня" },
    { value: addDays(today, 1), label: "Завтра" },
    { value: nextFriday(today), label: "До пятницы" },
    { value: addDays(today, 7), label: "Через неделю" },
    { value: addDays(today, 14), label: "Через две недели" },
  ];
  const seen = new Set<string>();
  return raw.filter((c) => !seen.has(c.value) && seen.add(c.value)).map((c) => ({ ...c, description: dueLong(c.value) }));
}

/**
 * «Дать задание» (ADR 0021): что задать (урок, «Испытание места» или повторение слов), место и урок тропы, срок.
 * У выбранного урока — «Что в уроке» (getLessonPreview): слова, фразы и задания.
 * Повтор нажатия не выдаёт второе задание (Idempotency-Key). Ученики видят задание на тропе сразу.
 */
export function GiveAssignmentDialog({
  open,
  onClose,
  classId,
  options,
  today,
  onGiven,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  options: Option[];
  today: string;
  onGiven: (a: Schema<"ClassAssignment">) => void;
}) {
  const toast = useToast();
  const places = useMemo(() => {
    const byOrder = new Map<number, { order: number; placeRu: string; lessons: Option[]; test?: Option }>();
    for (const o of options) {
      const p = byOrder.get(o.unitOrder) ?? { order: o.unitOrder, placeRu: o.placeRu, lessons: [] };
      if (o.kind === "place_test") p.test = o;
      else p.lessons.push(o);
      byOrder.set(o.unitOrder, p);
    }
    return [...byOrder.values()].sort((a, b) => a.order - b.order);
  }, [options]);
  const dues = useMemo(() => dueChoices(today), [today]);

  const [kind, setKind] = useState<AssignmentKind | null>("lesson");
  const [place, setPlace] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string>(uuidv7());

  // Каждое открытие — с начала: урок первого места и срок «до пятницы».
  useEffect(() => {
    if (!open) return;
    setKind("lesson");
    setPlace(places[0] ? String(places[0].order) : null);
    setLessonId(places[0]?.lessons[0]?.lessonId ?? null);
    setDue(nextFriday(today));
    setError(null);
    setBusy(false);
  }, [open, places, today]);

  const current = places.find((p) => String(p.order) === place);
  const placeOptions = places.filter((p) => (kind === "place_test" ? p.test : p.lessons.length > 0));
  const target: Option | undefined = kind === "place_test" ? current?.test : kind === "lesson" ? current?.lessons.find((l) => l.lessonId === lessonId) : undefined;
  const ready = Boolean(due && (kind === "review" || target));

  const choosePlace = (value: string) => {
    setPlace(value);
    setLessonId(places.find((p) => String(p.order) === value)?.lessons[0]?.lessonId ?? null);
  };

  const submit = async () => {
    if (!kind || !due || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const body: Schema<"CreateAssignmentRequest"> = kind === "review" ? { kind, dueOn: due } : { kind, lessonId: target!.lessonId, dueOn: due };
      const given = await unwrap(
        api.POST("/api/v1/classes/{id}/assignments", { params: { path: { id: classId }, header: { "Idempotency-Key": idempotencyKey.current } }, body }),
      );
      idempotencyKey.current = uuidv7();
      toast(`Задание выдано: ${assignmentTitle(given)}`);
      onGiven(given);
      onClose();
    } catch (e) {
      const fields = fieldErrors(e);
      setError(fields["dueOn"] ?? fields["lessonId"] ?? describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Задание классу" wide>
      <Form className="tt-stack tt-stack--loose sheet-form" onSubmit={() => void submit()}>
        <div className="give-task__row">
          <ChoiceGroup
            legend="Что задать"
            value={kind}
            onChange={(k) => {
              setKind(k);
              if (k === "place_test" && !current?.test) {
                const first = places.find((p) => p.test);
                if (first) setPlace(String(first.order));
              }
            }}
            options={(Object.keys(KIND_LABEL) as AssignmentKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
        </div>
        {kind !== "review" && placeOptions.length > 0 ? (
          <div className="give-task__row">
            <ChoiceGroup legend="Место на тропе" value={place} onChange={choosePlace} options={placeOptions.map((p) => ({ value: String(p.order), label: p.placeRu }))} />
          </div>
        ) : null}
        {kind === "lesson" && current && current.lessons.length > 0 ? (
          <ChoiceGroup
            legend="Урок"
            value={lessonId}
            onChange={setLessonId}
            options={current.lessons.map((l, i) => ({ value: l.lessonId, label: l.titleRu, mark: <span className="give-task__num">{i + 1}</span> }))}
          />
        ) : null}
        {target ? <LessonPeek lessonId={target.lessonId} test={target.kind === "place_test"} /> : null}
        <div className="give-task__dues">
          <ChoiceGroup legend="Срок" value={due} onChange={setDue} options={dues} />
        </div>
        {/* Низ листа закреплён (teacher.css .sheet-foot): кнопка видна, пока учитель листает уроки и сроки. */}
        <div className="sheet-foot">
          {error ? (
            <div aria-live="polite">
              <InlineAlert tone="danger">{error}</InlineAlert>
            </div>
          ) : null}
          <Button type="submit" block loading={busy} disabled={!ready}>
            Дать задание
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
