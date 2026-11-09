import { Inject, Injectable } from "@nestjs/common";
import { generateQrCard, parseQrPayload } from "@teletau/auth-codes";
import { fold, normalize } from "@teletau/bashkir-text";
import type { Schema } from "@teletau/contracts";
import { and, asc, count, desc, eq, gt, inArray, isNull, max } from "drizzle-orm";
import type { Principal, RequestMeta } from "../../common/auth.js";
import { hexEquals, sha256Hex } from "../../common/crypto.js";
import { ACCOUNTS_PORT, TEACHER_SCHOOL_PORT, type AccountsPort, type TeacherSchoolPort } from "../../common/ports.js";
import { conflict, forbidden, gone, invalidField, notFound } from "../../common/problem.js";
import { currentAcademicYear } from "../../common/time.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { IdempotencyStore, requestFingerprint } from "../../infra/idempotency.js";
import { DB } from "../../infra/tokens.js";
import { AuditService } from "../admin/index.js";
import { ConsentService } from "../consent/index.js";
import { renderCardsPdf, siteAddress } from "./cards-pdf.js";
import { ClassPolicy, type ClassRow } from "./class-policy.js";
import { DirectoryService, toSchoolRef } from "./directory.service.js";
import { classSeats, classes, joinRequests, memberships, seatCards } from "./org.schema.js";
import { PrintJobStore, type PrintJobCard } from "./print-jobs.js";

export const MAX_SEATS = 99;
export type Seat = Schema<"Seat">;
export type ClassDetail = Schema<"ClassDetail">;

/** «5 «Б»» — как класс называют в школе. */
export const classTitle = (grade: number, letter: string) => `${grade} «${letter}»`;

/** Цифра или буква, у которой свёртка @teletau/bashkir-text — русская буква а–я: русский алфавит и особые башкирские буквы. */
const isClassLetterChar = (ch: string): boolean => /^[0-9]$/.test(ch) || /^[а-я]$/.test(fold(ch));

/**
 * Литера класса (CLAUDE.md, правило 7): каноническая форма @teletau/bashkir-text (NFC, без невидимых символов,
 * двойники внутри кириллических слов заменены — казахская «қ» → «ҡ», латинская «a» рядом с кириллицей → «а»),
 * верхний регистр. Допустимы 1–3 цифры, русские и башкирские буквы. Латиница без кириллицы рядом и буквы
 * других алфавитов (татарская «җ») не угадываются, а отклоняются (422) — так в базу не попадают двойники.
 */
export function normalizeClassLetter(raw: string): string {
  const s = normalize(normalize(raw).toLocaleUpperCase("ru-RU"));
  const chars = [...s];
  if (chars.length < 1 || chars.length > 3 || !chars.every(isClassLetterChar)) {
    throw invalidField("/letter", "Литера — 1–3 русские или башкирские буквы или цифры");
  }
  return s;
}

/** Результат проверки карточки при входе (ADR 0016 §5, шаги 2–3); дальше — admitSeat. */
export type CardCheck = { result: "invalid" } | { result: "revoked" } | { result: "ok"; seatId: string; classId: string; seatNumber: number };

/** Место, на которое можно войти (admitSeat): ученик места (если уже есть) и номер класса для режима интерфейса. */
export interface SeatAdmission {
  seatId: string;
  classId: string;
  accountId: string | null;
  grade: number;
}

const DUMMY_HASH = sha256Hex("teletau:no-such-card");

@Injectable()
export class ClassesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly policy: ClassPolicy,
    private readonly directory: DirectoryService,
    private readonly consents: ConsentService,
    private readonly audit: AuditService,
    private readonly printJobs: PrintJobStore,
    private readonly idempotency: IdempotencyStore,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
    @Inject(TEACHER_SCHOOL_PORT) private readonly teacherSchools: TeacherSchoolPort,
  ) {}

  // ── классы ──

  /** Только подтверждённый учитель; школа — из одобренной заявки (другая — 403 school_not_allowed). */
  async create(principal: Principal, body: Schema<"CreateClassRequest">, idempotencyKey?: string): Promise<ClassDetail> {
    return this.idempotency.run("createClass", principal.accountId, idempotencyKey, requestFingerprint(body), async () => {
      const schoolId = await this.teacherSchools.approvedSchoolId(principal.accountId);
      if (!schoolId) throw forbidden("teacher_not_verified");
      if (body.schoolId && body.schoolId !== schoolId) throw forbidden("school_not_allowed");
      const school = await this.directory.school(schoolId);
      if (!school) throw notFound();
      const letter = normalizeClassLetter(body.letter);
      try {
        const [row] = await this.db
          .insert(classes)
          .values({
            schoolId,
            teacherAccountId: principal.accountId,
            grade: body.grade,
            letter,
            program: body.program,
            academicYear: body.academicYear ?? currentAcademicYear(),
          })
          .returning();
        return this.teacherDetail(row!);
      } catch (e) {
        if (pgErrorCode(e) === "23505") throw conflict("class_exists");
        throw e;
      }
    });
  }

  /** Учителю — классы, которые он ведёт (со счётчиками); ученику — классы, где у него есть место. */
  async listMine(principal: Principal): Promise<Schema<"ClassList">> {
    const items: Schema<"ClassSummary">[] = [];
    if (principal.roles.includes("teacher")) {
      const rows = await this.db
        .select()
        .from(classes)
        .where(eq(classes.teacherAccountId, principal.accountId))
        .orderBy(desc(classes.academicYear), asc(classes.grade), asc(classes.letter));
      const ids = rows.map((r) => r.id);
      const stats = ids.length
        ? await this.db
            .select({ classId: classSeats.classId, seats: count(), students: count(classSeats.accountId) })
            .from(classSeats)
            .where(inArray(classSeats.classId, ids))
            .groupBy(classSeats.classId)
        : [];
      const byClass = new Map(stats.map((s) => [s.classId, s]));
      const schools = await this.directory.schoolRefs(rows.map((r) => r.schoolId));
      for (const r of rows) {
        items.push({
          ...this.summary(r, schools.get(r.schoolId)!, "teacher"),
          seatCount: byClass.get(r.id)?.seats ?? 0,
          studentCount: byClass.get(r.id)?.students ?? 0,
        });
      }
    }
    if (principal.roles.includes("student")) {
      const rows = await this.db
        .select({ c: classes })
        .from(memberships)
        .innerJoin(classes, eq(classes.id, memberships.classId))
        .where(and(eq(memberships.accountId, principal.accountId), eq(memberships.role, "student"), isNull(memberships.leftAt)));
      const schools = await this.directory.schoolRefs(rows.map((r) => r.c.schoolId));
      for (const { c } of rows) items.push(this.summary(c, schools.get(c.schoolId)!, "student"));
    }
    return { items };
  }

  /** Классы для GET /me. */
  async myClasses(principal: Pick<Principal, "accountId" | "roles">): Promise<Schema<"MyClass">[]> {
    const out: Schema<"MyClass">[] = [];
    const teacherRows = principal.roles.includes("teacher")
      ? await this.db.select().from(classes).where(eq(classes.teacherAccountId, principal.accountId)).orderBy(desc(classes.academicYear))
      : [];
    const studentRows = principal.roles.includes("student")
      ? await this.db
          .select({ c: classes, seatNumber: classSeats.seatNumber })
          .from(memberships)
          .innerJoin(classes, eq(classes.id, memberships.classId))
          .leftJoin(classSeats, eq(classSeats.id, memberships.seatId))
          .where(and(eq(memberships.accountId, principal.accountId), eq(memberships.role, "student"), isNull(memberships.leftAt)))
      : [];
    const schools = await this.directory.schoolRefs([...teacherRows.map((r) => r.schoolId), ...studentRows.map((r) => r.c.schoolId)]);
    for (const r of teacherRows) out.push({ id: r.id, title: classTitle(r.grade, r.letter), schoolName: schools.get(r.schoolId)?.shortNameRu ?? "", role: "teacher" });
    for (const r of studentRows) {
      out.push({
        id: r.c.id,
        title: classTitle(r.c.grade, r.c.letter),
        schoolName: schools.get(r.c.schoolId)?.shortNameRu ?? "",
        role: "student",
        ...(r.seatNumber !== null ? { seatNumber: r.seatNumber } : {}),
      });
    }
    return out;
  }

  /** Политика class-member: учителю — места, код и заявки; ученику — общие сведения и номер его места. */
  async get(principal: Principal, classId: string): Promise<ClassDetail> {
    const access = await this.policy.requireMember(principal, classId);
    if (access.role === "teacher") return this.teacherDetail(access.row);
    const school = (await this.directory.schoolRefs([access.row.schoolId])).get(access.row.schoolId)!;
    return { ...this.summary(access.row, school, "student"), ...(access.seatNumber !== undefined ? { mySeatNumber: access.seatNumber } : {}) };
  }

  // ── места и карточки ──

  /** Выпуск N мест с карточками: в базе — только хеши секретов, сами секреты — в задании печати (ADR 0016 §4). */
  async issueSeats(principal: Principal, classId: string, n: number, meta: RequestMeta, idempotencyKey?: string): Promise<Schema<"SeatIssueResult">> {
    return this.idempotency.run(`issueSeats:${classId}`, principal.accountId, idempotencyKey, requestFingerprint({ count: n }), () =>
      this.db.transaction(async (tx) => {
        const cls = await this.lockTeacherClass(tx, principal, classId);
        const last = await this.lastSeatNumber(tx, classId);
        if (last + n > MAX_SEATS) throw conflict("seat_limit_exceeded", `в классе уже ${last} мест`);
        const now = new Date();
        const seats = await tx
          .insert(classSeats)
          .values(Array.from({ length: n }, (_, i) => ({ classId, seatNumber: last + 1 + i })))
          .returning();
        const cards = seats.map((s) => ({ seat: s, card: generateQrCard() }));
        await tx.insert(seatCards).values(
          cards.map(({ seat, card }) => ({
            seatId: seat.id,
            version: 1,
            handle: card.seat,
            secretHash: sha256Hex(card.secret),
            issuedByAccountId: principal.accountId,
            issuedAt: now,
          })),
        );
        const numbers = seats.map((s) => s.seatNumber);
        await this.audit.record(tx, {
          action: "card.issued",
          actor: principal,
          target: { type: "class", id: cls.id },
          metadata: { seatNumbers: numbers, count: n, version: 1 },
          meta,
        });
        const printJob = await this.savePrintJob(principal, classId, cards.map(({ seat, card }) => ({ seatNumber: seat.seatNumber, payload: card.payload })));
        return {
          printJob,
          seats: seats.map((s) => ({ number: s.seatNumber, cardStatus: "active" as const, cardVersion: 1, cardIssuedAt: now.toISOString() })),
        };
      }),
    );
  }

  /**
   * Выпуск карточки места: старая карточка → revoked (вход по ней — card_revoked), новая — version + 1; ученик и
   * прогресс остаются. Если на месте есть ученик, все его сессии завершаются (`card_reissued`) и выдача сессий по его
   * заявкам кода класса закрывается — и при перевыпуске (кто успел войти потерянной карточкой, теряет доступ),
   * и при первой карточке места, занятого по коду класса (учитель «выселяет» вошедшего по коду, законный
   * ученик входит по новой карточке в тот же аккаунт). Стоп-лист обновляется после фиксации транзакции.
   * `Idempotency-Key`: повтор с тем же ключом возвращает первый результат, а не выпускает ещё одну карточку.
   */
  async reissue(principal: Principal, classId: string, seatNumber: number, meta: RequestMeta, idempotencyKey?: string): Promise<Schema<"SeatIssueResult">> {
    return this.idempotency.run(`reissueSeatCard:${classId}`, principal.accountId, idempotencyKey, requestFingerprint({ seat: seatNumber }), async () => {
      let revokedFamilies: string[] = [];
      const result = await this.db.transaction(async (tx) => {
        await this.lockTeacherClass(tx, principal, classId);
        const [found] = await tx.select({ id: classSeats.id }).from(classSeats).where(and(eq(classSeats.classId, classId), eq(classSeats.seatNumber, seatNumber)));
        if (!found) throw notFound();
        // Блокировка места, как у входа (admitSeat): вход, начатый раньше, завершится до выпуска — и его сессия
        // попадёт под отзыв ниже; вход позже увидит отозванную карточку. Ученика места читаем уже под блокировкой.
        await this.policy.lockSeat(tx, found.id);
        const [seat] = await tx.select().from(classSeats).where(eq(classSeats.id, found.id));
        const [prev] = await tx.select({ v: max(seatCards.version) }).from(seatCards).where(eq(seatCards.seatId, seat!.id));
        const version = (prev?.v ?? 0) + 1;
        const now = new Date();
        await tx
          .update(seatCards)
          .set({ status: "revoked", revokedAt: now })
          .where(and(eq(seatCards.seatId, seat!.id), eq(seatCards.status, "active")));
        const card = generateQrCard();
        await tx
          .insert(seatCards)
          .values({ seatId: seat!.id, version, handle: card.seat, secretHash: sha256Hex(card.secret), issuedByAccountId: principal.accountId, issuedAt: now });
        if (seat!.accountId) revokedFamilies = await this.accounts.revokeAllSessions(tx, seat!.accountId, "card_reissued");
        await this.audit.record(tx, {
          action: version === 1 ? "card.issued" : "card.reissued",
          actor: principal,
          target: { type: "class_seat", id: seat!.id },
          metadata: { classId, seatNumber, version, ...(seat!.accountId ? { sessionsRevoked: revokedFamilies.length } : {}) },
          meta,
        });
        const printJob = await this.savePrintJob(principal, classId, [{ seatNumber, payload: card.payload }]);
        return { printJob, seatId: seat!.id };
      });
      await this.accounts.blockSessions(revokedFamilies);
      return { printJob: result.printJob, seats: await this.seatViews(classId, [result.seatId]) };
    });
  }

  /**
   * PDF задания печати: только для учителя класса, только живые карточки задания. Задание истекло (30 минут) —
   * 410 print_job_expired; все его карточки уже заменены новым выпуском — 410 print_job_replaced.
   */
  async cardsPdf(principal: Principal, classId: string, printJobId: string): Promise<{ pdf: Buffer; title: string }> {
    const { cls, cards } = await this.liveJobCards(principal, classId, printJobId);
    const school = await this.directory.school(cls.schoolId);
    const consent = await this.consents.currentText("consent_child");
    const title = classTitle(cls.grade, cls.letter);
    // В QR — только полезная нагрузка, без ссылки (ADR 0016 §2); адрес сайта печатается текстом без секрета.
    const pdf = await renderCardsPdf({
      classTitle: title,
      schoolName: school?.shortNameRu ?? "",
      siteAddress: siteAddress(this.config.PUBLIC_WEB_URL),
      cards: cards.map((c) => ({ seatNumber: c.seatNumber, payload: c.payload })),
      ...(consent ? { consent: { title: consent.title, version: consent.version, body: consent.body } } : {}),
    });
    return { pdf, title };
  }

  /**
   * Живые карточки задания печати с полезными нагрузками — ровно те, что попадут в PDF (cardsPdf), с теми же проверками:
   * только учитель класса, задание не истекло (410 print_job_expired) и не заменено целиком (410 print_job_replaced).
   * Для демо-сида (src/demo/seed.ts): он раздаёт карточки демо-ученикам, не разбирая PDF. По HTTP секреты карточек
   * уходят только в PDF (ADR 0016 §4) — у этого метода нет операции контракта.
   */
  async printJobCards(principal: Principal, classId: string, printJobId: string): Promise<PrintJobCard[]> {
    return (await this.liveJobCards(principal, classId, printJobId)).cards;
  }

  private async liveJobCards(principal: Principal, classId: string, printJobId: string): Promise<{ cls: ClassRow; cards: PrintJobCard[] }> {
    const cls = await this.policy.requireTeacher(principal, classId);
    const job = await this.printJobs.load(printJobId);
    if (!job) throw gone("print_job_expired");
    if (job.classId !== classId || job.teacherId !== principal.accountId) throw notFound();
    const active = await this.db
      .select({ handle: seatCards.handle })
      .from(seatCards)
      .innerJoin(classSeats, eq(classSeats.id, seatCards.seatId))
      .where(and(eq(classSeats.classId, classId), eq(seatCards.status, "active")));
    const live = new Set(active.map((a) => a.handle));
    const cards = job.cards.filter((c) => {
      const parsed = parseQrPayload(c.payload);
      return parsed.ok && live.has(parsed.seat);
    });
    if (cards.length === 0) throw gone("print_job_replaced");
    return { cls, cards };
  }

  // ── вход по карточке (вызывает identity) ──

  /** Проверка карточки: хеш секрета сравнивается за постоянное время; неверный секрет неотличим от чужой карточки. */
  async verifyCard(handle: string, secret: string): Promise<CardCheck> {
    const [row] = await this.db
      .select({ card: seatCards, seatNumber: classSeats.seatNumber, classId: classSeats.classId })
      .from(seatCards)
      .innerJoin(classSeats, eq(classSeats.id, seatCards.seatId))
      .where(eq(seatCards.handle, handle));
    const ok = hexEquals(row?.card.secretHash ?? DUMMY_HASH, sha256Hex(secret));
    if (!row || !ok) return { result: "invalid" };
    if (row.card.status !== "active") return { result: "revoked" };
    return { result: "ok", seatId: row.card.seatId, classId: row.classId, seatNumber: row.seatNumber };
  }

  /**
   * Можно ли войти на место — одна проверка для всех путей входа ученика: QR-карточка и выдача сессии по
   * заявке кода класса, первая и повторная. По порядку ADR 0016 §5: карточка `cardHandle` (если вход по карточке)
   * всё ещё действует — иначе 403 card_revoked; класс не в архиве — иначе 403 class_archived; бумажное согласие места
   * не отозвано — иначе 403 consent_revoked (отсутствие отметки вход не блокирует).
   * Сначала берётся блокировка места до конца транзакции `tx` (ClassPolicy.lockSeat) — ту же берут отзыв согласия и
   * выпуск карточки. Поэтому сессию, выданную в `tx`, отзыв либо увидит и завершит, либо (если отзыв был раньше)
   * `tx` увидит отзыв и сессию не выдаст: «между» шагами отзыва вход не проскакивает.
   */
  async admitSeat(tx: Db, seatId: string, cardHandle?: string): Promise<SeatAdmission> {
    await this.policy.lockSeat(tx, seatId);
    const [row] = await tx
      .select({ classId: classSeats.classId, accountId: classSeats.accountId, grade: classes.grade, classStatus: classes.status })
      .from(classSeats)
      .innerJoin(classes, eq(classes.id, classSeats.classId))
      .where(eq(classSeats.id, seatId));
    if (!row) throw notFound();
    if (cardHandle !== undefined) {
      const [card] = await tx.select({ status: seatCards.status }).from(seatCards).where(and(eq(seatCards.handle, cardHandle), eq(seatCards.seatId, seatId)));
      if (card?.status !== "active") throw forbidden("card_revoked");
    }
    if (row.classStatus === "archived") throw forbidden("class_archived");
    if (await this.consents.isSeatBlocked(seatId, tx)) throw forbidden("consent_revoked");
    return { seatId, classId: row.classId, accountId: row.accountId, grade: row.grade };
  }

  /**
   * Вход по личной карточке ученика «Учусь сам», вступившего в класс (ADR 0022): если родитель отозвал бумажное
   * согласие на каком-либо его месте — 403 consent_revoked, как у входа по карточке места. Архив класса вход
   * самостоятельного ученика не закрывает — он учится и без класса. Места блокируются (ClassPolicy.lockSeat) так же,
   * как при входе на место: отзыв согласия и вход не пересекаются.
   */
  async admitAccount(tx: Db, accountId: string): Promise<void> {
    const seats = await tx
      .select({ seatId: classSeats.id })
      .from(memberships)
      .innerJoin(classSeats, eq(classSeats.id, memberships.seatId))
      .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "student"), isNull(memberships.leftAt)));
    for (const { seatId } of seats) {
      await this.policy.lockSeat(tx, seatId);
      if (await this.consents.isSeatBlocked(seatId, tx)) throw forbidden("consent_revoked");
    }
  }

  /**
   * Первый вход по карточке: место блокируется (FOR UPDATE), при пустом месте создаётся аккаунт (колбэк identity)
   * и членство в классе. Возвращает аккаунт места.
   */
  async claimSeat(tx: Db, seatId: string, createAccount: (tx: Db) => Promise<string>): Promise<{ accountId: string; created: boolean }> {
    const [seat] = await tx.select().from(classSeats).where(eq(classSeats.id, seatId)).for("update");
    if (!seat) throw notFound();
    if (seat.accountId) return { accountId: seat.accountId, created: false };
    const accountId = await createAccount(tx);
    await tx.update(classSeats).set({ accountId, boundAt: new Date() }).where(eq(classSeats.id, seatId));
    await tx.insert(memberships).values({ classId: seat.classId, accountId, role: "student", seatId });
    return { accountId, created: true };
  }

  // ── внутреннее ──

  /** Класс учителя под блокировкой строки: нумерация мест и выпуск карточек — по очереди. */
  async lockTeacherClass(tx: Db, principal: Principal, classId: string): Promise<ClassRow> {
    const cls = await this.policy.requireTeacher(principal, classId, tx);
    await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, classId)).for("update");
    if (cls.status === "archived") throw conflict("class_archived");
    return cls;
  }

  async lastSeatNumber(tx: Db, classId: string): Promise<number> {
    const [row] = await tx.select({ n: max(classSeats.seatNumber) }).from(classSeats).where(eq(classSeats.classId, classId));
    return row?.n ?? 0;
  }

  private async savePrintJob(principal: Principal, classId: string, cards: PrintJobCard[]): Promise<Schema<"PrintJob">> {
    const job = await this.printJobs.save({ classId, teacherId: principal.accountId, cards });
    return {
      id: job.id,
      expiresAt: job.expiresAt.toISOString(),
      seatNumbers: cards.map((c) => c.seatNumber),
      pdfPath: `/api/v1/classes/${classId}/cards.pdf?printJob=${job.id}`,
    };
  }

  private summary(r: ClassRow, school: Schema<"SchoolRef">, myRole: "teacher" | "student"): Schema<"ClassSummary"> {
    return { id: r.id, title: classTitle(r.grade, r.letter), grade: r.grade, letter: r.letter, program: r.program, academicYear: r.academicYear, school, myRole };
  }

  private async teacherDetail(row: ClassRow): Promise<ClassDetail> {
    const [school, seats, pending] = await Promise.all([
      this.directory.school(row.schoolId),
      this.seatViews(row.id),
      this.pendingJoinRequests(row.id),
    ]);
    return {
      ...this.summary(row, toSchoolRef(school!), "teacher"),
      seats,
      ...(row.joinCodeExpiresAt && row.joinCodeExpiresAt > new Date() ? { joinCode: { expiresAt: row.joinCodeExpiresAt.toISOString() } } : {}),
      pendingJoinRequestCount: pending,
    };
  }

  /** Заявки на вход, ждущие решения учителя (не истёкшие). */
  private async pendingJoinRequests(classId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(joinRequests)
      .where(and(eq(joinRequests.classId, classId), eq(joinRequests.status, "pending"), gt(joinRequests.expiresAt, new Date())));
    return row?.n ?? 0;
  }

  /** Места класса для учителя: карточка, ученик (только ник, ADR 0009), бумажное согласие. */
  async seatViews(classId: string, onlySeatIds?: string[]): Promise<Seat[]> {
    const seats = await this.db
      .select()
      .from(classSeats)
      .where(and(eq(classSeats.classId, classId), onlySeatIds ? inArray(classSeats.id, onlySeatIds) : undefined))
      .orderBy(asc(classSeats.seatNumber));
    if (seats.length === 0) return [];
    const ids = seats.map((s) => s.id);
    const [cards, nicknames, consents] = await Promise.all([
      this.db.select().from(seatCards).where(inArray(seatCards.seatId, ids)).orderBy(desc(seatCards.version)),
      this.accounts.nicknames(seats.flatMap((s) => (s.accountId ? [s.accountId] : []))),
      this.consents.seatConsents(ids),
    ]);
    const latest = new Map<string, (typeof cards)[number]>();
    for (const c of cards) if (!latest.has(c.seatId)) latest.set(c.seatId, c);
    return seats.map((s) => {
      const card = latest.get(s.id);
      const consent = consents.get(s.id);
      const nickname = s.accountId ? nicknames.get(s.accountId) : undefined;
      return {
        number: s.seatNumber,
        cardStatus: card ? card.status : "none",
        cardVersion: card?.version ?? 0,
        ...(card ? { cardIssuedAt: card.issuedAt.toISOString() } : {}),
        ...(s.accountId && s.boundAt
          ? { student: { accountId: s.accountId, ...(nickname ? { nickname } : {}), joinedAt: s.boundAt.toISOString() } }
          : {}),
        ...(consent ? { consent } : {}),
      };
    });
  }
}
