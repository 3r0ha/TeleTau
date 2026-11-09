// Привязка чата Telegram к вошедшему аккаунту (ADR 0020): единственное место, куда уходит initData Mini App, —
// POST /api/v1/telegram/link через клиент @teletau/session/api (access-токен вкладки, таймаут, типы контракта).
// API проверяет подпись и сохраняет только user.id (chat_id) и id аккаунта. Ошибка не мешает учёбе и не логируется:
// в initData профиль пользователя.
import { api, unwrap } from "@teletau/session/api";

export async function linkTelegramChat(initData: string): Promise<boolean> {
  try {
    await unwrap(api.POST("/api/v1/telegram/link", { body: { initData } }));
    return true;
  } catch {
    return false;
  }
}
