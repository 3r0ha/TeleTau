// Самостоятельное обучение (ADR 0022): личная карточка входа, почта взрослого, вступление в класс и настройки ученика.
// Типы — только из контракта (CLAUDE.md, правило 1); вход и «Учусь сам» — через BFF сессии (@teletau/session/client).
import { api, unwrap } from "@teletau/session/api";
import type { Schema } from "@teletau/contracts";

export const selfApi = {
  loginCard: () => unwrap(api.GET("/api/v1/me/login-card")),
  issueLoginCard: () => unwrap(api.POST("/api/v1/me/login-card")),
  attachEmail: (body: Schema<"AttachEmailRequest">) => unwrap(api.POST("/api/v1/me/email", { body })),
  requestOtp: (email: string) => unwrap(api.POST("/api/v1/auth/otp/request", { body: { email } })),
  joinClass: (code: string) => unwrap(api.POST("/api/v1/me/class-join", { body: { code } })),
  joinStatus: (requestId: string) => unwrap(api.GET("/api/v1/me/class-join/{requestId}", { params: { path: { requestId } } })),
  me: () => unwrap(api.GET("/api/v1/me")),
  updateMe: (body: Schema<"UpdateMeRequest">) => unwrap(api.PATCH("/api/v1/me", { body })),
  issueTelegramLinkCode: () => unwrap(api.POST("/api/v1/me/telegram/link-code")),
};
