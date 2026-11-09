// Вход ученика (ADR 0016 §5–6): по QR-карточке и по коду класса с одобрением учителя.
// Ребёнок не передаёт ни одного персонального данного: только карточку или код и ник из словаря (ADR 0009).
// Лимиты неверных попыток атомарны и не мешают верным: попытка берёт слот до проверки и по итогу
// явно отдаёт его — `fail()` для неудачи, `release()` для всего остального, в том числе исключения посередине
// (infra/rate-limiter.ts). Можно ли войти на место — одна проверка ClassesService.admitSeat в транзакции
// выдачи сессии: и для QR, и для выдачи сессии по заявке кода класса.
import { Inject, Injectable } from "@nestjs/common";
import { parseQrPayload } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import type { RequestMeta } from "../../common/auth.js";
import { forbidden, invalidField, notFound, unauthorized, unprocessable } from "../../common/problem.js";
import type { Db } from "../../db/database.js";
import { RateLimiter, type Limit } from "../../infra/rate-limiter.js";
import { DB } from "../../infra/tokens.js";
import { ClassesService, JoinService, POLL_INTERVAL_SECONDS } from "../org/index.js";
import { AccountsService } from "./accounts.service.js";
import { nicknameById } from "./nicknames.js";
import { SessionsService, type DeviceInfo, type SessionTokens } from "./sessions.service.js";

const MINUTE = 60_000;
/** ADR 0016 §5: 20 неверных попыток с одного IP за минуту → 429 (критерий приёмки 5). */
export const QR_IP_FAILURES: Limit = { max: 20, windowMs: MINUTE };
/** 10 неверных попыток на один идентификатор карточки за 10 минут → 429 для этой карточки. */
export const QR_CARD_FAILURES: Limit = { max: 10, windowMs: 10 * MINUTE };
/**
 * Код класса (ADR 0016 §6). Неверные коды считаются на устройство — 10 в минуту: опечатки одного ребёнка
 * не блокируют одноклассников за школьным NAT. Потолок на IP — 100 неверных в минуту: на всю школу за одним адресом
 * (несколько классов вводят код одновременно, первоклассники ошибаются часто), а подбор с одного адреса остаётся
 * бессмысленным — 32⁶ ≈ 1,07·10⁹ кодов, код живёт 15 минут, угаданный код даёт только заявку в очередь класса
 * (не больше 40 ожидающих), которую учитель видит и отклоняет. Устройство (installId) клиент выбирает сам,
 * поэтому защита от подбора — потолок на IP, а не лимит устройства. Верные заявки — отдельный щедрый лимит на IP
 * (весь класс и соседние классы школы).
 */
export const CLASS_CODE_DEVICE_FAILURES: Limit = { max: 10, windowMs: MINUTE };
export const CLASS_CODE_IP_FAILURES: Limit = { max: 100, windowMs: MINUTE };
export const CLASS_CODE_IP_REQUESTS: Limit = { max: 300, windowMs: MINUTE };
/** Опрос заявки: неверный X-Poll-Token — 30 в минуту с IP; опросов одной заявки — не чаще раза в секунду в среднем. */
export const POLL_IP_FAILURES: Limit = { max: 30, windowMs: MINUTE };
export const POLL_PER_REQUEST: Limit = { max: 60, windowMs: MINUTE };

export interface StudentSession {
  tokens: SessionTokens;
  accountId: string;
}

@Injectable()
export class StudentLoginService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly limiter: RateLimiter,
    private readonly classes: ClassesService,
    private readonly join: JoinService,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Порядок проверок — ADR 0016 §5. Разбор и секрет — под лимитами неудач (IP и карточка); дальше, в транзакции
   * выдачи сессии, — admitSeat: карточка ещё действует, класс не в архиве, согласие не отозвано (под блокировкой
   * места). При первом входе создаётся детский аккаунт без ника.
   */
  async loginWithQr(body: Schema<"QrLoginRequest">, meta: RequestMeta): Promise<StudentSession> {
    const card = await this.checkCard(body.payload, meta);
    return this.db.transaction(async (tx) => {
      const seat = await this.classes.admitSeat(tx, card.seatId, card.handle);
      const { accountId } = await this.classes.claimSeat(tx, card.seatId, (t) => this.accounts.createChildAccount(t, {}));
      const account = await this.accounts.get(accountId, tx);
      if (!account || account.status !== "active") throw forbidden();
      await this.accounts.touchLogin(tx, accountId);
      await this.accounts.applyGradeUiMode(tx, accountId, seat.grade);
      const tokens = await this.sessions.issue(tx, { accountId, kind: account.kind, roles: account.roles }, body.device);
      return { tokens, accountId };
    });
  }

  /** Разбор и секрет карточки под лимитами неудач: неверный разбор и неверный секрет — неудачи, остальное — нет. */
  private async checkCard(payload: string, meta: RequestMeta): Promise<{ seatId: string; handle: string }> {
    const ip = await this.limiter.reserve(`qr:ip:${this.limiter.ipKey(meta.ip)}`, QR_IP_FAILURES);
    try {
      const parsed = parseQrPayload(payload);
      if (!parsed.ok) {
        await ip.fail();
        throw unprocessable("payload_invalid");
      }
      // Карточка заблокирована за подбор (429) — это не неудача IP: finally вернёт его слот.
      const card = await this.limiter.reserve(`qr:card:${parsed.seat}`, QR_CARD_FAILURES);
      try {
        const check = await this.classes.verifyCard(parsed.seat, parsed.secret);
        if (check.result === "invalid") {
          await Promise.all([ip.fail(), card.fail()]);
          throw unauthorized("card_invalid");
        }
        // Секрет верный: отозванная карточка, архив и отзыв согласия подбором не считаются (ADR 0016).
        if (check.result === "revoked") throw forbidden("card_revoked");
        return { seatId: check.seatId, handle: parsed.seat };
      } finally {
        await card.release();
      }
    } finally {
      await ip.release();
    }
  }

  /**
   * Заявка на вход по коду класса; опечатка, чужой и истёкший код неразличимы (404 class_code_not_found).
   * Неудачи — на устройство и на IP (CLASS_CODE_DEVICE_FAILURES, CLASS_CODE_IP_FAILURES). Очередь класса ограничена
   * (JoinService.createRequest): 40 ожидающих — 429 join_queue_full; заявка устройства заменяет его прежнюю.
   */
  async requestByClassCode(body: Schema<"ClassCodeLoginRequest">, meta: RequestMeta): Promise<Schema<"ClassCodeLoginTicket">> {
    const nickname = nicknameById(body.nicknameId);
    if (!nickname) throw invalidField("/nicknameId", "Такого ника нет в словаре — выберите из предложенных");
    const ip = this.limiter.ipKey(meta.ip);
    const device = await this.limiter.reserve(`class-code:device:${body.device.installId}`, CLASS_CODE_DEVICE_FAILURES);
    let cls;
    try {
      const network = await this.limiter.reserve(`class-code:ip:${ip}`, CLASS_CODE_IP_FAILURES);
      try {
        cls = await this.join.findClassByCode(body.code);
        if (!cls) {
          await Promise.all([device.fail(), network.fail()]);
          throw notFound("class_code_not_found");
        }
      } finally {
        await network.release();
      }
    } finally {
      await device.release();
    }
    await this.limiter.consume(`class-code:ok:${ip}`, CLASS_CODE_IP_REQUESTS);
    return this.join.createRequest(cls, { key: nickname.id, text: nickname.text }, body.device as DeviceInfo);
  }

  /**
   * Опрос заявки предъявителем X-Poll-Token. Одобренная заявка даёт сессию (статус approved), дальше — consumed.
   * С `deviceInstallId` устройства заявки до её срока сессия выдаётся повторно — если ответ с ней потерялся:
   * новое семейство, прежние сессии аккаунта на этом устройстве отзываются. Выдача — только на место, куда можно
   * войти (JoinService.poll → admitSeat): иначе 403 class_archived или consent_revoked, как у QR; отзыв всех
   * сессий аккаунта закрывает и выдачу. Неверный токен неотличим от несуществующей заявки (404) и считается неудачей.
   */
  async poll(
    requestId: string,
    pollToken: string,
    deviceInstallId: string | undefined,
    meta: RequestMeta,
  ): Promise<{ status: Schema<"JoinRequestStatus">; expiresAt: Date; pollIntervalSeconds: number; session?: StudentSession }> {
    const attempt = await this.limiter.reserve(`poll:ip:${this.limiter.ipKey(meta.ip)}`, POLL_IP_FAILURES);
    let superseded: string[] = [];
    let result;
    try {
      await this.limiter.consume(`poll:req:${requestId}`, POLL_PER_REQUEST);
      result = await this.db.transaction(async (tx) => {
        const p = await this.join.poll(tx, requestId, pollToken, deviceInstallId);
        if (!p.found || !p.grant) return { p, session: undefined };
        const account = await this.accounts.get(p.grant.accountId, tx);
        if (!account || account.status !== "active") throw forbidden();
        if (p.grant.repeat) superseded = await this.sessions.revokeDevice(tx, account.id, p.grant.device.installId, "superseded");
        await this.accounts.touchLogin(tx, account.id);
        await this.accounts.applyGradeUiMode(tx, account.id, p.grant.grade);
        const tokens = await this.sessions.issue(tx, { accountId: account.id, kind: account.kind, roles: account.roles }, p.grant.device);
        return { p, session: { tokens, accountId: account.id } };
      });
      if (!result.p.found) {
        await attempt.fail();
        throw notFound();
      }
    } finally {
      await attempt.release();
    }
    await this.sessions.blockFamilies(superseded);
    return {
      status: result.p.status,
      expiresAt: result.p.expiresAt,
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      ...(result.session ? { session: result.session } : {}),
    };
  }
}
