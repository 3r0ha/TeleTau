import type { Schema } from "@teletau/contracts";

export type Me = Schema<"Me">;

/** То, что BFF отдаёт браузеру вместо AuthSession: без refresh-токена (он — в httpOnly cookie). */
export type BrowserSession = Pick<Schema<"AuthSession">, "accessToken" | "accessTokenExpiresAt" | "account">;

/** Статус заявки по коду класса в ответе BFF: сессия — тоже без refresh-токена. */
export type BrowserClassCodeStatus = Omit<Schema<"ClassCodeLoginStatus">, "session"> & { session?: BrowserSession };

export type SessionState =
  | { status: "unknown" }
  /** reason — `code` ответа, которым API завершил сессию (например, `card_reissued`): экран входа объясняет почему. */
  | { status: "anonymous"; reason?: string }
  | {
      status: "authenticated";
      account: Me;
      accessToken: string;
      expiresAt: number;
      /** Роли из утверждения `roles` access-токена — снимок на момент выпуска (ADR 0015); `account.roles` — текущие из GET /me. */
      tokenRoles: string[];
    };
