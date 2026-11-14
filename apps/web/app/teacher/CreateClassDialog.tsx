"use client";

import { useRef, useState } from "react";
import type { Schema } from "@teletau/contracts";
import { Button, ChoiceGroup, Dialog, Form, HexAvatar, InlineAlert, TextField, useInvalidFocus } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem, fieldErrors } from "@teletau/session/problem";
import type { T } from "../../i18n/core";
import { useT } from "../../i18n/client";
import { ClassTitle } from "../_components/screens";
import { uuidv7 } from "../_components/learn/ids";

type Program = Schema<"ClassProgram">;

/** Подписи программ обучения — фабрика от переводчика (строки зависят от языка интерфейса). */
export function programLabels(t: T): Record<Program, string> {
  return {
    native: t("Родной язык"),
    state: t("Государственный язык РБ"),
    elective: t("Факультатив"),
  };
}

const GRADES = Array.from({ length: 11 }, (_, i) => String(i + 1));

/**
 * Создание класса: номер (1–11), литера, программа. Повтор нажатия не создаёт дубль (Idempotency-Key).
 * После создания onCreated переходит на страницу класса (router.replace) при открытом листе: запись листа в истории
 * заменяется страницей класса, и «Назад» с неё ведёт к списку классов.
 */
export function CreateClassDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [grade, setGrade] = useState<string | null>("5");
  const [letter, setLetter] = useState("");
  const [program, setProgram] = useState<Program | null>("native");
  const [letterError, setLetterError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string>(uuidv7());
  const invalid = useInvalidFocus();
  const t = useT();
  const programs = programLabels(t);

  const submit = async () => {
    const l = letter.trim();
    if (!l) {
      setLetterError(t("Укажите литеру класса."));
      invalid.request();
      return;
    }
    if (!grade || !program) return;
    setBusy(true);
    setError(null);
    try {
      const created = await unwrap(
        api.POST("/api/v1/classes", {
          params: { header: { "Idempotency-Key": idempotencyKey.current } },
          body: { grade: Number(grade), letter: l, program },
        }),
      );
      idempotencyKey.current = uuidv7();
      // Тоста нет: страница класса и так откроется. Лист не закрываем: страница сменится, а кнопка остаётся в ожидании — второго класса не будет.
      onCreated(created.id);
    } catch (e) {
      setBusy(false);
      const letterProblem = fieldErrors(e).letter;
      if (letterProblem) {
        setLetterError(letterProblem);
        invalid.request();
      } else setError(describeProblem(e));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Новый класс")}
      wide
    >
      <Form className="tt-stack tt-stack--loose sheet-form" invalidFocus={invalid} onSubmit={() => void submit()}>
        {/* Как класс будет выглядеть в кабинете — меняется вместе с выбором. */}
        <div className="class-preview" aria-hidden>
          <HexAvatar size={56} tone="honey" lip>
            {grade ?? "?"}
          </HexAvatar>
          <span className="class-preview__body">
            <b>
              <ClassTitle title={`${grade ?? "?"} «${letter.trim().toLocaleUpperCase("ru") || "…"}»`} />
            </b>
            <span>{program ? programs[program] : null}</span>
          </span>
        </div>
        <ChoiceGroup legend={t("Класс")} layout="inline" value={grade} onChange={setGrade} options={GRADES.map((g) => ({ value: g, label: g }))} />
        <TextField
          label={t("Литера")}
          name="letter"
          value={letter}
          onChange={(e) => {
            setLetter(e.target.value);
            setLetterError(null);
          }}
          maxLength={3}
          autoComplete="off"
          error={letterError}
          hint={t("Например, А или Б")}
        />
        <ChoiceGroup
          legend={t("Программа")}
          value={program}
          onChange={setProgram}
          options={(Object.keys(programs) as Program[]).map((p) => ({ value: p, label: programs[p] }))}
        />
        {/* Низ листа закреплён (teacher.css .sheet-foot): на ноутбуке 1280×720 и телефоне кнопка не уходит под край. */}
        <div className="sheet-foot">
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <Button type="submit" block loading={busy}>
            {t("Создать класс")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
