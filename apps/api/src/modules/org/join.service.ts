// Код класса и заявки на вход (ADR 0016 §6): код — 6 символов на 15 минут, в базе только HMAC;
// заявка ждёт одобрения учителя, ученик опрашивает её с секретом X-Poll-Token (в базе — SHA-256).
// Очередь заявок класса ограничена: не больше MAX_PENDING_JOIN_REQUESTS ожидающих, с одного устройства —
// одна; учитель гасит код сразу (closeCode), не дожидаясь 15 минут.
import { Inject, Injectable } from "@nestjs/common";
import { CLASS_CODE_TTL_SECONDS, formatClassCode, generateClassCode, parseClassCode } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import { and, count, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Principal, RequestMeta } from "../../common/auth.js";
import { hexEquals, hmacHex, randomTokenB64, sha256Hex } from "../../common/crypto.js";
import { ACCOUNTS_PORT, type AccountsPort } from "../../common/ports.js";
import { conflict, notFound, tooManyRequests } from "../../common/problem.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { AuditService } from "../admin/index.js";
import { ClassesService, MAX_SEATS, classTitle } from "./classes.service.js";
import { ClassPolicy, type ClassRow } from "./class-policy.js";
import { classSeats, classes, joinRequests, memberships } from "./org.schema.js";

/** Заявка живёт 15 минут; после одобрения — ещё 15 минут на выдачу сессии. */
export const JOIN_REQUEST_TTL_MS = 15 * 60 * 1000;
export const POLL_INTERVAL_SECONDS = 3;
/**
 * Ожидающих решения учителя заявок в классе — не больше (ADR 0016 §6): класс до 40 учеников входит по коду
 * весь сразу, а больше учитель на одном экране не разберёт. Сверх — 429 join_queue_full.
 */
export const MAX_PENDING_JOIN_REQUESTS = 40;
/** Retry-After при полной очереди: учитель разбирает заявки за десятки секунд, опрашивать чаще бессмысленно. */
export const JOIN_QUEUE_RETRY_AFTER_SECONDS = 30;
/** Срок постоянного кода стенда показа (AUTH_DEMO_CLASS_CODE): «не истекает» — продлевается каждым выпуском. */
export const DEMO_CLASS_CODE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type JoinRow = typeof joinRequests.$inferSelect;
type JoinStatus = Schema<"JoinRequestStatus">;

export interface JoinDevice {
  installId: string;
  platform: Schema<"DevicePlatform">;
  appVersion?: string;
}

/**
 * Результат опроса заявки (для identity). `grant` — выдать сессию: при первом опросе после одобрения и (`repeat`)
 * при повторном опросе с устройства заявки до её срока, если ответ с сессией потерялся. Выдача возможна
 * только на место, куда можно войти (ClassesService.admitSeat), — иначе poll бросает тот же 403, что и QR.
 * `grade` — номер класса для режима интерфейса.
 */
export type JoinPoll =
  | { found: false }
  | {
      found: true;
      requestId: string;
      status: JoinStatus;
      expiresAt: Date;
      grant?: { accountId: string; device: JoinDevice; grade: number; repeat: boolean };
    };

/** Статус с учётом срока: ожидающая заявка после expires_at — expired. */
const effectiveStatus = (r: Pick<JoinRow, "status" | "expiresAt">, now = new Date()): JoinStatus =>
  r.status === "pending" && r.expiresAt <= now ? "expired" : r.status;

/** То же правило, что effectiveStatus, условием SQL: заявки, чей статус с учётом срока — `status`. */
function statusFilter(status: JoinStatus, now: Date): SQL | undefined {
  if (status === "pending") return and(eq(joinRequests.status, "pending"), gt(joinRequests.expiresAt, now));
  if (status === "expired") return or(eq(joinRequests.status, "expired"), and(eq(joinRequests.status, "pending"), lte(joinRequests.expiresAt, now)));
  return eq(joinRequests.status, status);
}

@Injectable()
export class JoinService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly policy: ClassPolicy,
    private readonly classesService: ClassesService,
    private readonly audit: AuditService,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
  ) {}

  private codeHash(code: string): string {
    return hmacHex(this.config.AUTH_SECRET_PEPPER, `class-code:${code}`);
  }

  /** Новый код класса; прежний перестаёт действовать. Сам код возвращается только здесь. */
  async issueCode(principal: Principal, classId: string, meta: RequestMeta): Promise<Schema<"JoinCode">> {
    const cls = await this.policy.requireTeacher(principal, classId);
    if (cls.status === "archived") throw conflict("class_archived");
    if (this.config.AUTH_DEMO_CLASS_CODE) return this.issueDemoCode(principal, classId, this.config.AUTH_DEMO_CLASS_CODE, meta);
    const expiresAt = new Date(Date.now() + CLASS_CODE_TTL_SECONDS * 1000);
    for (let attempt = 0; ; attempt++) {
      const code = generateClassCode();
      try {
        await this.db.transaction(async (tx) => {
          await tx.update(classes).set({ joinCodeHash: this.codeHash(code.code), joinCodeExpiresAt: expiresAt }).where(eq(classes.id, classId));
          await this.audit.record(tx, { action: "class.join_code_issued", actor: principal, target: { type: "class", id: classId }, meta });
        });
        return { code: code.code, display: code.display, expiresAt: expiresAt.toISOString(), permanent: false };
      } catch (e) {
        // Совпадение HMAC с действующим кодом другого класса — выпускаем другой код (ADR 0016 §6).
        if (pgErrorCode(e) !== "23505" || attempt >= 5) throw e;
      }
    }
  }

  /**
   * Постоянный код стенда показа (AUTH_DEMO_CLASS_CODE): один код на весь стенд — у класса, где он был, снимается,
   * этот класс получает его на год. Выпуски по очереди (рекомендательная блокировка): два класса не перехватывают код
   * друг у друга наперегонки и не упираются в уникальный индекс хеша. Заявки, одобрение и очередь — как у обычного кода.
   */
  private async issueDemoCode(principal: Principal, classId: string, code: string, meta: RequestMeta): Promise<Schema<"JoinCode">> {
    const hash = this.codeHash(code);
    const expiresAt = new Date(Date.now() + DEMO_CLASS_CODE_TTL_MS);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('teletau:demo-class-code', 0))`);
      await tx
        .update(classes)
        .set({ joinCodeHash: null, joinCodeExpiresAt: null })
        .where(and(eq(classes.joinCodeHash, hash), ne(classes.id, classId)));
      await tx.update(classes).set({ joinCodeHash: hash, joinCodeExpiresAt: expiresAt }).where(eq(classes.id, classId));
      await this.audit.record(tx, { action: "class.join_code_issued", actor: principal, target: { type: "class", id: classId }, meta });
    });
    return { code, display: formatClassCode(code), expiresAt: expiresAt.toISOString(), permanent: true };
  }

  /** Класс по введённому коду; опечатка, чужой и истёкший код неразличимы (undefined → 404 class_code_not_found). */
  async findClassByCode(input: string): Promise<ClassRow | undefined> {
    const parsed = parseClassCode(input);
    if (!parsed.ok) return undefined;
    const [row] = await this.db
      .select()
      .from(classes)
      .where(and(eq(classes.joinCodeHash, this.codeHash(parsed.code)), gt(classes.joinCodeExpiresAt, new Date()), eq(classes.status, "active")));
    return row;
  }

  /**
   * Гасит действующий код класса сразу: хеш и срок — NULL, новые заявки по коду — 404 class_code_not_found.
   * Уже поданные заявки остаются у учителя. Идемпотентно: кода нет или он истёк — ничего не меняется (204);
   * в аудит (`class.join_code_closed`) пишется только погашение действующего кода. Строка класса блокируется
   * (FOR UPDATE), как при подаче заявки: заявка, которая нашла код до закрытия, перепроверяет его под той же
   * блокировкой и после закрытия не создаётся (createRequest). Постоянный код стенда показа (AUTH_DEMO_CLASS_CODE)
   * не гасится — 204, код остаётся.
   */
  async closeCode(principal: Principal, classId: string, meta: RequestMeta): Promise<void> {
    const demoHash = this.config.AUTH_DEMO_CLASS_CODE ? this.codeHash(this.config.AUTH_DEMO_CLASS_CODE) : undefined;
    await this.db.transaction(async (tx) => {
      await this.policy.requireTeacher(principal, classId, tx);
      const [row] = await tx
        .select({ hash: classes.joinCodeHash, expiresAt: classes.joinCodeExpiresAt })
        .from(classes)
        .where(and(eq(classes.id, classId), isNotNull(classes.joinCodeHash)))
        .for("update");
      if (!row || row.hash === demoHash) return;
      await tx.update(classes).set({ joinCodeHash: null, joinCodeExpiresAt: null }).where(eq(classes.id, classId));
      if (row.expiresAt && row.expiresAt > new Date()) await this.audit.record(tx, { action: "class.join_code_closed", actor: principal, target: { type: "class", id: classId }, meta });
    });
  }

  /**
   * Заявка на вход по коду: ник уже выбран из словаря, учитель увидит её на странице класса. `cls` — класс, найденный
   * по коду (findClassByCode). Ответ называет класс только номером и литерой — без школы (docs/02 §9).
   *
   * Очередь класса — в транзакции под блокировкой строки класса (FOR UPDATE, как у одобрения и отказа), так что
   * параллельные заявки идут по одной и предел точен при любой параллельности:
   * 1. код перепроверяется под блокировкой: его могли погасить или заменить, пока шёл запрос, — тогда 404;
   * 2. прежняя ожидающая заявка этого устройства в классе становится expired (её опрос так и ответит);
   * 3. ожидающих (pending и не истёкших) уже MAX_PENDING_JOIN_REQUESTS — 429 join_queue_full, и шаг 2 откатывается.
   */
  async createRequest(
    cls: ClassRow,
    nickname: { key: string; text: string },
    device: JoinDevice,
    /** Заявка уже вошедшего ученика «Учусь сам» (ADR 0022): при одобрении место получит этот аккаунт. */
    requesterAccountId?: string,
  ): Promise<Schema<"ClassCodeLoginTicket">> {
    const pollToken = `ttp_${randomTokenB64(32)}`;
    const row = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(
          and(
            eq(classes.id, cls.id),
            eq(classes.joinCodeHash, cls.joinCodeHash ?? ""),
            gt(classes.joinCodeExpiresAt, new Date()),
            eq(classes.status, "active"),
          ),
        )
        .for("update");
      if (!locked) throw notFound("class_code_not_found");
      // Часы — те же, что у findClassByCode и счётчика заявок на странице класса (сроки записаны часами API); после
      // ожидания блокировки.
      const now = new Date();
      await tx
        .update(joinRequests)
        .set({ status: "expired" })
        .where(and(eq(joinRequests.classId, cls.id), eq(joinRequests.status, "pending"), eq(joinRequests.deviceInstallId, device.installId)));
      const [queue] = await tx
        .select({ n: count() })
        .from(joinRequests)
        .where(and(eq(joinRequests.classId, cls.id), eq(joinRequests.status, "pending"), gt(joinRequests.expiresAt, now)));
      if ((queue?.n ?? 0) >= MAX_PENDING_JOIN_REQUESTS) throw tooManyRequests(JOIN_QUEUE_RETRY_AFTER_SECONDS, "join_queue_full");
      const [inserted] = await tx
        .insert(joinRequests)
        .values({
          classId: cls.id,
          nicknameKey: nickname.key,
          nickname: nickname.text,
          pollTokenHash: sha256Hex(pollToken),
          deviceInstallId: device.installId,
          devicePlatform: device.platform,
          appVersion: device.appVersion ?? null,
          requesterAccountId: requesterAccountId ?? null,
          expiresAt: new Date(now.getTime() + JOIN_REQUEST_TTL_MS),
        })
        .returning();
      return inserted;
    });
    return {
      requestId: row!.id,
      pollToken,
      status: "pending",
      expiresAt: row!.expiresAt.toISOString(),
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      class: { title: classTitle(cls.grade, cls.letter), grade: cls.grade, letter: cls.letter },
    };
  }

  /**
   * Опрос заявки предъявителем секрета (политика poll-token). Одобренная заявка в транзакции `tx` переводится
   * в consumed и отдаёт аккаунт и устройство — identity выдаёт по ним сессию в той же транзакции. Повторно (`repeat`) —
   * только тому же устройству (`deviceInstallId` совпал с устройством заявки) и до срока выдачи: ответ с сессией мог
   * потеряться.
   * Заявка, которой уже выдано место (approved, consumed), сначала проходит проверку входа на это место —
   * ClassesService.admitSeat, ту же, что у QR: класс в архиве или отзыв согласия — 403 class_archived или
   * consent_revoked, первый опрос или повторный. Проверка берёт блокировку места, поэтому заявку перечитываем уже
   * под ней (FOR UPDATE): отзыв доступа, которого мы ждали, мог закрыть выдачу (JoinGrants.close). Срок выдачи
   * сравнивается с часами Postgres — теми же, которыми его закрывает JoinGrants, а не с часами экземпляра API.
   */
  async poll(tx: Db, requestId: string, pollToken: string, deviceInstallId?: string): Promise<JoinPoll> {
    const [first] = await tx.select().from(joinRequests).where(eq(joinRequests.id, requestId));
    if (!hexEquals(first?.pollTokenHash ?? sha256Hex("teletau:no-such-request"), sha256Hex(pollToken)) || !first) return { found: false };
    const status = effectiveStatus(first);
    if ((status !== "approved" && status !== "consumed") || !first.accountId || !first.seatId) {
      return { found: true, requestId, status, expiresAt: first.expiresAt };
    }
    const seat = await this.classesService.admitSeat(tx, first.seatId);
    const [locked] = await tx
      .select({ row: joinRequests, open: sql<boolean>`${joinRequests.expiresAt} > statement_timestamp()` })
      .from(joinRequests)
      .where(eq(joinRequests.id, requestId))
      .for("update");
    const { row, open } = locked!;
    // Одобренную заявку нужно забрать в течение срока выдачи; позже ученик подаёт новую. Место сменило ученика —
    // выдачи тоже нет (сейчас так не бывает, но сессия другого аккаунта на место выдаваться не должна).
    if (row.status === "approved" && (!open || seat.accountId !== row.accountId)) return { found: true, requestId, status: "expired", expiresAt: row.expiresAt };
    if (row.status !== "approved" && row.status !== "consumed") return { found: true, requestId, status: effectiveStatus(row), expiresAt: row.expiresAt };
    const repeat = row.status === "consumed";
    const sameDevice = deviceInstallId !== undefined && deviceInstallId === row.deviceInstallId;
    if (repeat && (!sameDevice || !open || seat.accountId !== row.accountId)) return { found: true, requestId, status: "consumed", expiresAt: row.expiresAt };
    if (!repeat) await tx.update(joinRequests).set({ status: "consumed" }).where(eq(joinRequests.id, requestId));
    return {
      found: true,
      requestId,
      status: "approved",
      expiresAt: row.expiresAt,
      grant: {
        accountId: row.accountId!,
        device: { installId: row.deviceInstallId, platform: row.devicePlatform as JoinDevice["platform"], ...(row.appVersion ? { appVersion: row.appVersion } : {}) },
        grade: seat.grade,
        repeat,
      },
    };
  }

  /**
   * Заявки класса за последние сутки, новые сверху (политика class-teacher). Фильтр по статусу — в SQL, с учётом срока
   * (как effectiveStatus): диалог учителя опрашивает `status=pending` каждые 3 с и получает не больше
   * MAX_PENDING_JOIN_REQUESTS строк, сколько бы заявок, заменённых и истёкших, ни набралось за сутки.
   */
  async list(principal: Principal, classId: string, status?: JoinStatus): Promise<Schema<"JoinRequestList">> {
    await this.policy.requireTeacher(principal, classId);
    const now = new Date();
    const rows = await this.db
      .select({ r: joinRequests, seatNumber: classSeats.seatNumber })
      .from(joinRequests)
      .leftJoin(classSeats, eq(classSeats.id, joinRequests.seatId))
      .where(and(eq(joinRequests.classId, classId), gt(joinRequests.createdAt, new Date(now.getTime() - 24 * 3600_000)), status ? statusFilter(status, now) : undefined))
      .orderBy(desc(joinRequests.createdAt));
    return { items: rows.map(({ r, seatNumber }) => this.view(r, seatNumber, now)) };
  }

  /**
   * Одобрение: детский аккаунт без ПДн с ником из заявки, новое место без карточки, членство; в аудит. Заявка ученика
   * «Учусь сам» (requester_account_id, ADR 0022) аккаунт не создаёт: место привязывается к нему, прогресс остаётся.
   * Ученик бывает только в одном классе: если он уже учится в этом или другом классе (одобрили вторую заявку, в том
   * числе параллельно у другого учителя) — 409 already_in_class. Проверка — под блокировкой аккаунта заявителя.
   */
  async approve(principal: Principal, classId: string, requestId: string, meta: RequestMeta): Promise<Schema<"JoinRequest">> {
    return this.db.transaction(async (tx) => {
      await this.classesService.lockTeacherClass(tx, principal, classId);
      const row = await this.openRequest(tx, classId, requestId);
      if (row.requesterAccountId) {
        // Два учителя одобряют заявки одного ученика в разные классы: блокировка учителя класса их не упорядочивает.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`teletau:class-join:${row.requesterAccountId}`}, 0))`);
        const [member] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.accountId, row.requesterAccountId), eq(memberships.role, "student"), isNull(memberships.leftAt)));
        if (member) throw conflict("already_in_class");
      }
      const seatNumber = (await this.classesService.lastSeatNumber(tx, classId)) + 1;
      if (seatNumber > MAX_SEATS) throw conflict("seat_limit_exceeded");
      const accountId = row.requesterAccountId ?? (await this.accounts.createChildAccount(tx, { nicknameKey: row.nicknameKey, nickname: row.nickname }));
      const now = new Date();
      const [seat] = await tx.insert(classSeats).values({ classId, seatNumber, accountId, boundAt: now }).returning();
      await tx.insert(memberships).values({ classId, accountId, role: "student", seatId: seat!.id });
      const [updated] = await tx
        .update(joinRequests)
        .set({
          status: "approved",
          accountId,
          seatId: seat!.id,
          decidedByAccountId: principal.accountId,
          decidedAt: now,
          expiresAt: new Date(now.getTime() + JOIN_REQUEST_TTL_MS),
        })
        .where(eq(joinRequests.id, requestId))
        .returning();
      await this.audit.record(tx, {
        action: "join_request.approved",
        actor: principal,
        target: { type: "join_request", id: requestId },
        metadata: { classId, seatNumber },
        meta,
      });
      return this.view(updated!, seatNumber);
    });
  }

  async reject(principal: Principal, classId: string, requestId: string, meta: RequestMeta): Promise<Schema<"JoinRequest">> {
    return this.db.transaction(async (tx) => {
      await this.classesService.lockTeacherClass(tx, principal, classId);
      await this.openRequest(tx, classId, requestId);
      const [updated] = await tx
        .update(joinRequests)
        .set({ status: "rejected", decidedByAccountId: principal.accountId, decidedAt: new Date() })
        .where(eq(joinRequests.id, requestId))
        .returning();
      await this.audit.record(tx, { action: "join_request.rejected", actor: principal, target: { type: "join_request", id: requestId }, metadata: { classId }, meta });
      return this.view(updated!, null);
    });
  }

  /**
   * Статус заявки ученика «Учусь сам» в класс (GET /me/class-join/{id}, ADR 0022): только своей — чужая или
   * несуществующая неразличимы (undefined → 404). Класс — номером и литерой, без школы, как в ответе на код.
   */
  async requesterStatus(accountId: string, requestId: string): Promise<Schema<"ClassJoinTicket"> | undefined> {
    const [row] = await this.db
      .select({ r: joinRequests, grade: classes.grade, letter: classes.letter })
      .from(joinRequests)
      .innerJoin(classes, eq(classes.id, joinRequests.classId))
      .where(and(eq(joinRequests.id, requestId), eq(joinRequests.requesterAccountId, accountId)));
    if (!row) return undefined;
    return {
      requestId,
      status: effectiveStatus(row.r),
      expiresAt: row.r.expiresAt.toISOString(),
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      class: { title: classTitle(row.grade, row.letter), grade: row.grade, letter: row.letter },
    };
  }

  /** Заявка этого класса в статусе pending и не истёкшая; иначе 404 или 409 join_request_closed. */
  private async openRequest(tx: Db, classId: string, requestId: string): Promise<JoinRow> {
    const [row] = await tx.select().from(joinRequests).where(and(eq(joinRequests.id, requestId), eq(joinRequests.classId, classId))).for("update");
    if (!row) throw notFound();
    if (effectiveStatus(row) !== "pending") throw conflict("join_request_closed");
    return row;
  }

  private view(r: JoinRow, seatNumber: number | null, now = new Date()): Schema<"JoinRequest"> {
    return {
      id: r.id,
      status: effectiveStatus(r, now),
      nickname: r.nickname,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      ...(r.decidedAt ? { decidedAt: r.decidedAt.toISOString() } : {}),
      ...(seatNumber !== null ? { seatNumber } : {}),
    };
  }
}

