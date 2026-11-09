"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { Schema } from "@teletau/contracts";
import { useSession } from "@teletau/session/react";
import type { SessionState } from "@teletau/session/types";

type UiMode = Schema<"UiMode">;

/** Экраны ученика до входа: возраст ещё неизвестен — режим «Пчёлка» (крупные цели подходят всем возрастам). */
const BEFORE_LOGIN = ["/q", "/student", "/student/code", "/student/wait", "/self"];

/**
 * Возрастной режим интерфейса (docs/05-design-system.md §7): API выставляет `Me.uiMode` по классу ученика
 * (1–4 → bee, 5–8 → bortnik, 9–11 → keeper), самостоятельному ученику — по возрасту (ADR 0022: взрослый, который
 * учится, — keeper). undefined — без режима (учителя и сотрудники: обычные размеры);
 * null — ещё неизвестно (сессия восстанавливается), режим не трогаем.
 */
export function uiModeFor(state: SessionState, path: string): UiMode | undefined | null {
  if (state.status === "authenticated") return state.account.kind === "child" ? (state.account.uiMode ?? "bortnik") : state.account.nickname ? state.account.uiMode : undefined;
  // Telegram Mini App — те же экраны под префиксом /miniapp (app/miniapp, docs/plans/M2.md §3 «Ч5»).
  if (BEFORE_LOGIN.includes(path.replace(/^\/miniapp(?=\/student)/, ""))) return "bee";
  return state.status === "unknown" ? null : undefined;
}

/** Ставит data-mode на <html>: в режиме bee ui.css увеличивает цели нажатия (56 px) и текст. */
export function UiModeSync() {
  const state = useSession();
  const path = usePathname();
  const mode = uiModeFor(state, path);
  useEffect(() => {
    if (mode === null) return;
    const root = document.documentElement;
    if (mode) root.dataset.mode = mode;
    else delete root.dataset.mode;
  }, [mode]);
  return null;
}
