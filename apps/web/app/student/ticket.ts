"use client";

import type { Schema } from "@teletau/contracts";
import { serverNow } from "@teletau/session/clock";

/**
 * Заявка на вход по коду класса — в sessionStorage вкладки: переживает перезагрузку, но не закрытие вкладки
 * и не дольше срока заявки (контракт: pollToken «не сохранять дольше срока заявки»).
 */
type LoginTicket = Schema<"ClassCodeLoginTicket">;
export type JoinTicket = Pick<LoginTicket, "requestId" | "pollToken" | "expiresAt" | "pollIntervalSeconds"> & {
  classTitle: LoginTicket["class"]["title"];
  nickname: Schema<"NicknameSuggestion">["text"];
};

const KEY = "tt-join-ticket";

export function saveTicket(t: LoginTicket, nickname: string) {
  const ticket: JoinTicket = {
    requestId: t.requestId,
    pollToken: t.pollToken,
    expiresAt: t.expiresAt,
    pollIntervalSeconds: t.pollIntervalSeconds,
    // Школу ответ на код класса не раскрывает: в заявке — только класс.
    classTitle: t.class.title,
    nickname,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ticket));
  } catch {
    /* приватный режим — заявка живёт только в памяти этой страницы */
  }
  memory = ticket;
}

let memory: JoinTicket | null = null;

export function loadTicket(): JoinTicket | null {
  let t = memory;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) t = JSON.parse(raw) as JoinTicket;
  } catch {
    /* нет доступа к хранилищу */
  }
  // Срок — по часам сервера (clock.ts): при сбитых часах устройства живая заявка не должна «истечь».
  if (t && Date.parse(t.expiresAt) < serverNow() - 60_000) {
    clearTicket();
    return null;
  }
  return t;
}

export function clearTicket() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ничего */
  }
}
