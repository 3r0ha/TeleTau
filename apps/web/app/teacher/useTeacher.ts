"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { useRequireAccount, useResource, type Resource } from "@teletau/session/react";
import type { Me } from "@teletau/session/types";

export type TeacherStep = "/teacher/terms" | "/teacher/apply" | "/teacher/pending" | "/teacher";

/** Куда должен попасть взрослый: условия → заявка → ожидание → кабинет. */
export function nextTeacherStep(me: Me): TeacherStep {
  if (me.pendingConsents.length > 0) return "/teacher/terms";
  if (me.teacherStatus === "none") return "/teacher/apply";
  if (me.teacherStatus === "pending" || me.teacherStatus === "rejected") return "/teacher/pending";
  return "/teacher";
}

const ALLOWED: Record<string, (me: Me) => boolean> = {
  terms: (me) => me.pendingConsents.length > 0,
  apply: (me) => me.pendingConsents.length === 0 && (me.teacherStatus === "none" || me.teacherStatus === "rejected"),
  pending: (me) => me.pendingConsents.length === 0 && (me.teacherStatus === "pending" || me.teacherStatus === "rejected"),
  verified: (me) => me.pendingConsents.length === 0 && me.teacherStatus === "verified",
  any: () => true,
};

/**
 * Экран кабинета учителя: нужен вход взрослого (иначе — /teacher/login) и подходящий этап регистрации
 * (иначе — переход на нужный этап). Подтверждённому учителю без роли teacher в access-токене (одобрили после
 * входа) токен обновляется (ADR 0015: роли — снимок на момент выпуска); запросы API дожидаются нового токена.
 */
export function useTeacherGate(stage: keyof typeof ALLOWED, opts: { pollMs?: number } = {}): { me: Me | null; resource: Resource<Me> } {
  const account = useRequireAccount("adult", "/teacher/login");
  const router = useRouter();
  const resource = useResource(() => unwrap(api.GET("/api/v1/me")), [account?.id], { enabled: Boolean(account), pollMs: opts.pollMs });
  const refreshed = useRef(false);
  const me = resource.data ?? null;

  useEffect(() => {
    if (!me) return;
    session.updateAccount(me);
    // GET /me отдаёт текущие роли аккаунта, а проверка доступа API — роли из токена: их и сверяем.
    if (me.teacherStatus === "verified" && !session.tokenHasRole("teacher") && !refreshed.current) {
      refreshed.current = true;
      void session.refresh();
    }
    if (!ALLOWED[stage]!(me)) router.replace(nextTeacherStep(me));
  }, [me, stage, router]);

  return { me: me && ALLOWED[stage]!(me) ? me : null, resource };
}
