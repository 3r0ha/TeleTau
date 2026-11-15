"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { normalizeCodeInput, parseClassCode } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import { Button, CodeInput, EmptyState, InlineAlert, LinkButton, StepHeading } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { useOnline, useResource } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";
import { ClassTitle, LoadingBlock, Screen, SimpleTop, useDocumentTitle } from "../screens";
import { useStudentPaths } from "./paths";
import { selfApi } from "./self-api";
import { studentClass, useStudent } from "./StudentShell";

type Ticket = Schema<"ClassJoinTicket">;

/** Ошибки ввода кода (parseClassCode) — на языке интерфейса (t доступен только при рендере). */
const codeErrors = (t: T) => ({
  empty: t("Введи код с доски."),
  invalid_character: t("В коде только буквы и цифры."),
  invalid_length: t("В коде 6 символов."),
});

/** Заявка — в sessionStorage вкладки: перезагрузка во время ожидания её не теряет (живёт 15 минут). */
const TICKET_KEY = "tt-class-join";

function loadTicket(): Ticket | null {
  try {
    const raw = sessionStorage.getItem(TICKET_KEY);
    return raw ? (JSON.parse(raw) as Ticket) : null;
  } catch {
    return null;
  }
}

function saveTicket(t: Ticket | null) {
  try {
    if (t) sessionStorage.setItem(TICKET_KEY, JSON.stringify(t));
    else sessionStorage.removeItem(TICKET_KEY);
  } catch {
    /* приватный режим — заявка живёт только на этой странице */
  }
}

/**
 * «Вступить в класс» (ADR 0022): ученик «Учусь сам» вводит код с доски — учитель видит заявку с его ником и пускает
 * в класс. Аккаунт тот же: мёд, серия и слова остаются, класс просто появляется во вкладке «Класс».
 */
export function JoinClassScreen() {
  const me = useStudent();
  const paths = useStudentPaths();
  const router = useRouter();
  const t = useT();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  useEffect(() => setTicket(loadTicket()), []);
  useDocumentTitle(ticket ? t("Ждём учителя") : t("Вступить в класс"));

  const status = useResource(() => selfApi.joinStatus(ticket!.requestId), [ticket?.requestId], {
    enabled: Boolean(ticket),
    pollMs: (ticket?.pollIntervalSeconds ?? 3) * 1000,
  });
  const state = status.data?.status ?? ticket?.status;
  const offline = useOnline();

  // Учитель пустил — класс уже в GET /me: обновляем аккаунт и идём в улей класса.
  useEffect(() => {
    if (state !== "approved") return;
    saveTicket(null);
    void selfApi.me().then((fresh) => {
      session.updateAccount(fresh);
      router.replace(paths.hive);
    });
  }, [state, router, paths.hive]);

  const submit = async () => {
    const parsed = parseClassCode(code);
    if (!parsed.ok) {
      setCodeError(codeErrors(t)[parsed.error]);
      return;
    }
    setBusy(true);
    setCodeError(null);
    try {
      const t = await selfApi.joinClass(code);
      saveTicket(t);
      setTicket(t);
    } catch (e) {
      setCodeError(describeProblem(e, "child", t));
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    saveTicket(null);
    setTicket(null);
    setCode("");
  };

  return (
    <Screen top={<SimpleTop back={paths.hive} title={t("Вступить в класс")} />} className="join-class">
      {!me ? (
        <LoadingBlock rows={2} />
      ) : studentClass(me) && state !== "approved" ? (
        <EmptyState art="sceneClassHive" title={t("Ты уже в классе")}>
          {t("Улей класса — во вкладке «Класс».")}
        </EmptyState>
      ) : ticket && (state === "rejected" || state === "expired") ? (
        <EmptyState
          art="beeSympathy"
          title={state === "rejected" ? t("Учитель не принял заявку") : t("Заявка устарела")}
          actions={
            <Button block onClick={again}>
              {t("Ввести код")}
            </Button>
          }
        >
          {state === "rejected" ? t("Подойди к учителю и попробуй ещё раз.") : t("Попроси учителя показать код ещё раз.")}
        </EmptyState>
      ) : ticket ? (
        <EmptyState
          art="beeIdle"
          title={t("Ждём учителя")}
          role="status"
          actions={
            <>
              {/* Опрос продолжается сам; сеть пропала — заявка не теряется, а страница проверит снова, когда связь вернётся. */}
              {offline ? <InlineAlert tone="honey">{t("Нет связи. Заявка не потеряется.")}</InlineAlert> : null}
              {status.error && !offline ? <InlineAlert tone="danger">{describeProblem(status.error, "child", t)}</InlineAlert> : null}
              <LinkButton tone="neutral" onClick={again}>
                {t("Отменить")}
              </LinkButton>
            </>
          }
        >
          <p>
            {t("Класс")} <ClassTitle title={ticket.class.title} />. {t("Скажи учителю свой ник:")} <b>«{me.nickname}»</b>.
          </p>
          <p>{t("Как только учитель примет, эта страница сама обновится и ты попадёшь в класс.")}</p>
        </EmptyState>
      ) : (
        <form
          className="tt-stack tt-stack--loose"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <header className="tt-stack tt-stack--tight">
            <StepHeading focusKey="code">{t("Введи код класса")}</StepHeading>
            <p className="tt-lead">{t("Код написан на доске в классе. Мёд и серия сохранятся.")}</p>
          </header>
          <CodeInput
            length={6}
            charset="code"
            groupSize={3}
            compact
            label={t("Код класса")}
            value={code}
            onChange={(v) => {
              setCode(v);
              setCodeError(null);
            }}
            normalize={normalizeCodeInput}
            error={codeError}
            autoFocus
          />
          <Button type="submit" block loading={busy} disabled={code.length < 6}>
            {t("Отправить заявку")}
          </Button>
        </form>
      )}
    </Screen>
  );
}
