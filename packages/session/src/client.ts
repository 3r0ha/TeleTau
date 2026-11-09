// Сессия в браузере (ADR 0015 §2–3): access-токен — только в памяти вкладки; refresh-токен браузерный JS не видит
// (httpOnly cookie, ставит BFF). Обновление — строго по одному на все вкладки (navigator.locks), иначе одновременное
// предъявление одного refresh-токена двумя вкладками выглядело бы как кража и отзывало бы всё семейство.
import type { Schema } from "@teletau/contracts";
import { observeServerDate, serverNow } from "./clock";
import { BROWSER_REQUEST_TIMEOUT_MS, SESSION_PATH } from "./config";
import { ApiProblem, toApiProblem } from "./problem";
import { withShortRetry } from "./retry";
import type { BrowserClassCodeStatus, BrowserSession, Me, SessionState } from "./types";

const LOCK_NAME = "tt-session-refresh";
/** Обновлять access-токен заранее, если до конца срока меньше этого. */
const EARLY_REFRESH_MS = 30_000;
/** Снимок для серверной отрисовки: сессия ещё неизвестна. */
const SERVER_STATE: SessionState = { status: "unknown" };

type Listener = () => void;

/**
 * Роли из access-токена (JWT, утверждение `roles`). Подпись проверяет API; клиенту роли нужны только чтобы понять,
 * пора ли обновить токен: роль `teacher` появляется в токене после ближайшего обновления (ADR 0015 §1).
 */
export function tokenRoles(accessToken: string): string[] {
  try {
    const part = accessToken.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const roles = (JSON.parse(json) as { roles?: unknown }).roles;
    return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

async function post<T>(action: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const sentAt = Date.now();
  const res = await fetch(`${SESSION_PATH}/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
    signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS),
  });
  // Тот же origin: заголовок Date виден всегда — по нему поправка часов устройства (clock.ts).
  observeServerDate(res, sentAt);
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({}));
  // Retry-After (BFF передаёт его от API) — в ApiProblem: по нему решается повтор и текст ошибки.
  if (!res.ok) throw toApiProblem(data, res);
  return data as T;
}

class SessionStore {
  private state: SessionState = { status: "unknown" };
  private readonly listeners = new Set<Listener>();
  private inflight: Promise<boolean> | null = null;
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.channel = new BroadcastChannel("tt-session");
      // Выход в одной вкладке — выход во всех: refresh-токен уже отозван.
      this.channel.onmessage = (e: MessageEvent) => {
        if (e.data === "logout") this.set({ status: "anonymous" });
      };
    }
  }

  getState = (): SessionState => this.state;
  // Один и тот же объект: useSyncExternalStore требует кешированный снимок сервера (иначе — предупреждение React
  // «getServerSnapshot should be cached» и значок «1 Issue» поверх экрана в pnpm dev).
  getServerState = (): SessionState => SERVER_STATE;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(next: SessionState) {
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }

  private accept(s: BrowserSession) {
    this.set({
      status: "authenticated",
      account: s.account,
      accessToken: s.accessToken,
      // Срок — по часам сервера (accessToken() сравнивает его с serverNow()): при сбитых часах устройства токен
      // иначе казался бы просроченным, и каждый запрос начинался бы с обновления.
      expiresAt: Date.parse(s.accessTokenExpiresAt),
      tokenRoles: tokenRoles(s.accessToken),
    });
  }

  /** Восстановить сессию после загрузки страницы (access-токена в памяти ещё нет). */
  async restore(): Promise<SessionState> {
    if (this.state.status === "unknown") await this.refresh();
    return this.state;
  }

  /** Обновить пару токенов через BFF. Один запрос на вкладку и одна вкладка за раз. */
  refresh(): Promise<boolean> {
    if (!this.inflight) {
      const run = async () => {
        try {
          this.accept(await post<BrowserSession>("refresh"));
          return true;
        } catch (e) {
          // Токен отвергнут — сессии нет. Сеть или API недоступны — уже открытую сессию не теряем
          // (refresh-токен остался в cookie), а неизвестное состояние считаем «не вошёл».
          // 429 (слишком частые обновления) — тоже не выход из аккаунта.
          const rejected = e instanceof ApiProblem && e.status !== 503 && e.status !== 429;
          if (rejected) this.set({ status: "anonymous", ...(e.code ? { reason: e.code } : {}) });
          else if (this.state.status === "unknown") this.set({ status: "anonymous" });
          return false;
        }
      };
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      const job = locks ? locks.request(LOCK_NAME, run) : run();
      this.inflight = job.finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Действующий access-токен (при необходимости — после обновления) или null. */
  async accessToken(): Promise<string | null> {
    // Идёт обновление (например, учителя только что одобрили и токен перевыпускается с ролью teacher) —
    // запрос со старым токеном получил бы 403 от проверки роли, поэтому сначала дожидаемся нового.
    if (this.inflight) await this.inflight;
    const s = this.state;
    if (s.status === "authenticated" && s.expiresAt - serverNow() > EARLY_REFRESH_MS) return s.accessToken;
    if (s.status === "anonymous") return null;
    return (await this.refresh()) && this.state.status === "authenticated" ? this.state.accessToken : null;
  }

  /**
   * Вход по QR-карточке: полезная нагрузка `TT1.…` уходит только в теле запроса к BFF — не в адрес и не в историю.
   * Короткий 429 (`Retry-After` ≤ 5 с) повторяется молча: отклонённый вход ничего не создал.
   */
  async loginWithQr(payload: string): Promise<Me> {
    const s = await withShortRetry(() => post<BrowserSession>("qr", { payload }));
    this.accept(s);
    return s.account;
  }

  /**
   * Вход по личной карточке самостоятельного ученика `TP1.…` (ADR 0022) — как по карточке места: нагрузка только
   * в теле запроса к BFF, короткий 429 повторяется молча.
   */
  async loginWithCard(payload: string): Promise<Me> {
    const s = await withShortRetry(() => post<BrowserSession>("card", { payload }));
    this.accept(s);
    return s.account;
  }

  /** «Учусь сам» (ADR 0022): аккаунт без ПДн — ник из словаря, возрастной диапазон и (по желанию) цель дня. */
  async startSelf(body: { nicknameId: string; ageBand: Schema<"AgeBand">; dailyGoal?: number }): Promise<Me> {
    const s = await post<BrowserSession>("self", body);
    this.accept(s);
    return s.account;
  }

  /** Вход взрослого или сотрудника: одноразовый код (и TOTP для сотрудника). */
  async loginWithOtp(challengeId: string, code: string, totp?: string): Promise<Me> {
    const s = await post<BrowserSession>("otp", { challengeId, code, ...(totp ? { totp } : {}) });
    this.accept(s);
    return s.account;
  }

  /**
   * Заявка на вход по коду класса (через BFF — к ней привязывается устройство будущей сессии). Короткий 429
   * повторяется молча, как у входа по QR; 429 `join_queue_full` (очередь класса полна) — нет.
   */
  requestClassCode(code: string, nicknameId: string) {
    return withShortRetry(() => post<Schema<"ClassCodeLoginTicket">>("class-code", { code, nicknameId }));
  }

  /** Опрос заявки; при одобрении BFF ставит cookie, а здесь сессия становится активной. */
  async pollClassCode(requestId: string, pollToken: string): Promise<BrowserClassCodeStatus> {
    const status = await post<BrowserClassCodeStatus>("class-code-status", { requestId, pollToken });
    if (status.session) this.accept(status.session);
    return status;
  }

  /** Есть ли роль в текущем access-токене (а не только в аккаунте — см. tokenRoles). */
  tokenHasRole(role: string): boolean {
    return this.state.status === "authenticated" && this.state.tokenRoles.includes(role);
  }

  /** Обновить сведения об аккаунте после GET/PATCH /me. */
  updateAccount(account: Me) {
    if (this.state.status === "authenticated") this.set({ ...this.state, account });
  }

  async logout(): Promise<void> {
    const token = this.state.status === "authenticated" ? this.state.accessToken : undefined;
    try {
      await post<void>("logout", {}, token ? { authorization: `Bearer ${token}` } : undefined);
    } finally {
      this.set({ status: "anonymous" });
      this.channel?.postMessage("logout");
    }
  }
}

export const session = new SessionStore();
