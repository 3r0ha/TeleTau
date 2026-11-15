"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Schema } from "@teletau/contracts";
import { SignOut } from "@phosphor-icons/react/ssr";
import { ButtonLink, EmptyState, InlineAlert, LinkButton } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { ApiProblem, describeProblem, isNetworkError } from "@teletau/session/problem";
import { ClassTitle, Screen, SimpleTop } from "../../_components/screens";
import { useStudentPaths } from "../../_components/learn/paths";
import { clearTicket, loadTicket, type JoinTicket } from "../ticket";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";

type Status = Schema<"JoinRequestStatus"> | "missing" | "closed";

/** Вход на место закрыт (403 при опросе): заголовок и текст для ребёнка. */
interface Closed {
  title: string;
  text: string;
}

/**
 * Учитель закрыл вход (отзыв согласия родителем) или класс в архиве — ждать дальше бессмысленно. Текст про класс —
 * общий с входом по QR (describeProblem); про согласие — без слова «карточка»: ученик входил по коду класса.
 */
function closedBy(t: T, e: ApiProblem): Closed {
  if (e.code === "class_archived") return { title: t("Класс закрыт"), text: describeProblem(e, "child", t) };
  return { title: t("Вход закрыт"), text: t("Подойди к учителю.") };
}

/** «Ждём, пока учитель подтвердит»: опрос заявки раз в pollIntervalSeconds; при одобрении — сессия и класс. */
export default function WaitPage() {
  const router = useRouter();
  const paths = useStudentPaths();
  const t = useT();
  const [ticket, setTicket] = useState<JoinTicket | null>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Closed | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Локальное имя — «saved», чтобы не затенять переводчик t (useT).
    const saved = loadTicket();
    if (!saved) {
      setStatus("missing");
      return;
    }
    setTicket(saved);
    let stopped = false;
    const poll = async () => {
      try {
        const res = await session.pollClassCode(saved.requestId, saved.pollToken);
        if (stopped) return;
        setOffline(false);
        setError(null);
        setStatus(res.status);
        if (res.session) {
          clearTicket();
          // Первый вход в класс — «Ты в классе», оттуда «На тропу».
          router.replace(paths.joined);
          return;
        }
        if (res.status === "pending") timer.current = setTimeout(() => void poll(), Math.max(1, res.pollIntervalSeconds) * 1000);
        else clearTicket();
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiProblem && e.status === 404) {
          clearTicket();
          setStatus("expired");
          return;
        }
        // 403 consent_revoked / class_archived: на это место войти нельзя — опрос прекращается.
        if (e instanceof ApiProblem && e.status === 403) {
          clearTicket();
          setOffline(false);
          setError(null);
          setClosed(closedBy(t, e));
          setStatus("closed");
          return;
        }
        setOffline(isNetworkError(e));
        if (!isNetworkError(e)) setError(describeProblem(e, "child", t));
        timer.current = setTimeout(() => void poll(), Math.max(3, saved.pollIntervalSeconds) * 1000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [router, paths.joined, t]);

  const again = (
    <ButtonLink href={paths.code} block>
      {t("Ввести код")}
    </ButtonLink>
  );

  let body;
  if (status === "closed" && closed) {
    body = (
      <EmptyState
        art="beeSympathy"
        title={closed.title}
        role="alert"
        actions={
          <ButtonLink href={paths.login} block>
            {t("Выйти")}
          </ButtonLink>
        }
      >
        {closed.text}
      </EmptyState>
    );
  } else if (status === "missing") {
    body = (
      <EmptyState art="beeThink" title={t("Заявки нет")} actions={again}>
        {t("Введи код класса заново.")}
      </EmptyState>
    );
  } else if (status === "rejected") {
    body = (
      <EmptyState art="beeSympathy" title={t("Учитель не принял заявку")} role="alert" actions={again}>
        {t("Подойди к учителю и попробуй ещё раз.")}
      </EmptyState>
    );
  } else if (status === "expired") {
    body = (
      <EmptyState art="beeSleep" title={t("Заявка устарела")} role="alert" actions={again}>
        {t("Попроси учителя показать код ещё раз.")}
      </EmptyState>
    );
  } else if (status === "consumed") {
    body = (
      <EmptyState art="beeThink" title={t("Вход уже выполнен")} actions={again}>
        {t("Если это был не ты, введи код заново.")}
      </EmptyState>
    );
  } else {
    body = (
      <EmptyState
        art="beeIdle"
        title={t("Ждём учителя")}
        role="status"
        actions={
          <>
            {/* Отменить заявку на сервере нельзя (в контракте нет такой операции): кнопка честно уводит со страницы. */}
            <LinkButton
              tone="neutral"
              icon={<SignOut weight="bold" aria-hidden />}
              onClick={() => {
                clearTicket();
                router.replace(paths.login);
              }}
            >
              {t("Выйти")}
            </LinkButton>
          </>
        }
      >
        {ticket ? (
          <>
            <p>
              {t("Класс")} <ClassTitle title={ticket.classTitle} />. {t("Скажи учителю свой ник:")} <b>«{ticket.nickname}»</b>.
            </p>
            <p>{t("Как только учитель примет, эта страница сама обновится и ты попадёшь в класс.")}</p>
          </>
        ) : (
          t("Учитель скоро пустит тебя в класс. Как только он примет, эта страница сама обновится.")
        )}
      </EmptyState>
    );
  }

  return (
    <Screen top={<SimpleTop title={t("Вход по коду класса")} />}>
      {body}
      <div aria-live="polite">
        {offline ? <InlineAlert tone="honey">{t("Нет связи. Заявка не потеряется.")}</InlineAlert> : null}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </div>
    </Screen>
  );
}
