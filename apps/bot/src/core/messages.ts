/**
 * Канально-независимая модель диалога (docs/06-architecture.md §7, ADR 0007).
 * Ядро не знает о Telegram: адаптер переводит эти типы в формат конкретного мессенджера.
 * Правило: в исходящих сообщениях нет персональных данных (CLAUDE.md, правило 13) — ни имени, ни ника, ни chat_id.
 */
export type Incoming =
  | { chatId: string; kind: "command"; command: string; args: string }
  | { chatId: string; kind: "text"; text: string }
  /** Нажатие inline-кнопки: `data` — то, что ядро положило в ButtonAction.callback. */
  | { chatId: string; kind: "callback"; data: string };

export type ButtonAction = { kind: "openMiniApp"; url: string } | { kind: "callback"; data: string };

export interface Button {
  label: string;
  action: ButtonAction;
}

export interface Outgoing {
  text: string;
  /** Ряды кнопок под сообщением */
  buttons?: Button[][];
  /**
   * Постоянное меню под чатом (reply-клавиатура, is_persistent). У сообщения одно reply_markup — меню или inline
   * кнопки, не оба: сценарии ставят меню только на сообщения без inline-кнопок (Telegram не редактирует клавиатуру).
   */
  menu?: MenuButton[][];
}

/** Кнопка постоянного меню: с адресом — открывает Mini App (web_app, только https), без — присылает текст метки. */
export interface MenuButton {
  label: string;
  webAppUrl?: string;
}
