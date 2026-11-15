import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Principal, RequestMeta } from "../../common/auth.js";
import { ACCOUNTS_PORT, CLASS_ACCESS_PORT, type AccountsPort, type ClassAccessPort } from "../../common/ports.js";
import { describeError } from "../../common/errors.js";
import { conflict, forbidden, invalidField, notFound, unavailable } from "../../common/problem.js";
import { ufaToday } from "../../common/time.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { AuditService } from "../admin/index.js";
import { consents, legalDocuments } from "./consent.schema.js";
import { ADULT_REQUIRED_KINDS, LEGAL_TEXTS, legalText, type LegalDocumentKind } from "./legal-texts.js";

type DocumentRow = typeof legalDocuments.$inferSelect;

/** Повторы сида документов после неудачи при старте: 1, 2, 4, … 30 с. */
const SEED_RETRY_ATTEMPTS = 8;
const SEED_ON_DEMAND_INTERVAL_MS = 10_000;
type ConsentRow = typeof consents.$inferSelect;
export type Consent = Schema<"Consent">;
export type SeatConsent = Schema<"SeatConsent">;

const toDocument = (d: DocumentRow): Schema<"LegalDocument"> => ({
  id: d.id,
  kind: d.kind,
  version: d.version,
  title: d.title,
  ...(d.url ? { url: d.url } : {}),
  effectiveFrom: d.effectiveFrom.toISOString(),
});

/** SHA-256 текста версии: абзацы через пустую строку (legal_documents.body_sha256). */
const bodySha256 = (body: readonly string[]) => createHash("sha256").update(body.join("\n\n"), "utf8").digest("hex");

/** Страница документа в вебе: `${PUBLIC_WEB_URL}/legal/<вид>/<версия>` (apps/web/app/legal). */
export const legalDocumentUrl = (webUrl: string, kind: LegalDocumentKind, version: string) =>
  `${webUrl.replace(/\/+$/, "")}/legal/${kind}/${encodeURIComponent(version)}`;

/** Действующий текст документа (для бланка в PDF). */
export interface CurrentDocumentText {
  id: string;
  kind: LegalDocumentKind;
  version: string;
  title: string;
  body: string[];
}

/**
 * Модуль consent: версии документов, электронные согласия взрослых и бумажные согласия родителей на место ученика.
 * Политика consent-owner (ADR 0017): субъект согласия — сам взрослый; бумажное согласие — учитель класса.
 */
@Injectable()
export class ConsentService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ConsentService.name);
  /** Таймер повтора сида после неудачи при старте (база ещё не готова и т. п.). */
  private retryTimer: NodeJS.Timeout | undefined;
  /** Когда в последний раз пробовали досеять документы по запросу (не чаще раза в SEED_ON_DEMAND_INTERVAL_MS). */
  private lastOnDemandSeed = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    @Inject(CLASS_ACCESS_PORT) private readonly classes: ClassAccessPort,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
  ) {}

  /**
   * Сид: действующие версии документов (идемпотентно, по виду и версии). Ошибка сида не роняет старт, а повторяется
   * в фоне с растущей паузой; кроме того, запрос, увидевший пустой справочник, досеивает его сам.
   * Пока документов нет, принятие и проверка условий отвечают 503 documents_unavailable — а не «условия приняты».
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedDocuments();
    } catch (e) {
      this.logger.warn(`legal documents seed failed, will retry: ${describeError(e)}`);
      this.scheduleSeedRetry(1);
    }
  }

  onApplicationShutdown(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private scheduleSeedRetry(attempt: number): void {
    if (attempt > SEED_RETRY_ATTEMPTS) return;
    this.retryTimer = setTimeout(() => {
      this.seedDocuments().then(
        () => this.logger.log(`legal documents seeded on retry ${attempt}`),
        (e: unknown) => {
          this.logger.warn(`legal documents seed retry ${attempt} failed: ${describeError(e)}`);
          this.scheduleSeedRetry(attempt + 1);
        },
      );
    }, Math.min(30_000, 1000 * 2 ** (attempt - 1)));
    this.retryTimer.unref();
  }

  /** Действующие документы; если какого-то вида нет — одна попытка досеять (не чаще раза в 10 с) и повторное чтение. */
  private async currentDocumentsEnsured(): Promise<DocumentRow[]> {
    const rows = await this.currentDocuments();
    const kinds = new Set(rows.map((r) => r.kind));
    if (LEGAL_TEXTS.every((t) => kinds.has(t.kind)) || Date.now() - this.lastOnDemandSeed < SEED_ON_DEMAND_INTERVAL_MS) return rows;
    this.lastOnDemandSeed = Date.now();
    try {
      await this.seedDocuments();
    } catch (e) {
      this.logger.warn(`legal documents on-demand seed failed: ${describeError(e)}`);
      return rows;
    }
    return this.currentDocuments();
  }

  /** Действующие обязательные документы взрослого; нет хотя бы одного — 503 documents_unavailable. */
  private async requiredDocuments(): Promise<DocumentRow[]> {
    const current = (await this.currentDocumentsEnsured()).filter((d) => ADULT_REQUIRED_KINDS.includes(d.kind));
    if (ADULT_REQUIRED_KINDS.some((k) => !current.some((d) => d.kind === k))) throw unavailable("documents_unavailable");
    return current;
  }

  /**
   * Текст, заголовок и дата версии неизменяемы: при конфликте обновляется только адрес страницы (`url`) — он
   * зависит от PUBLIC_WEB_URL окружения, а не от версии документа.
   */
  async seedDocuments(): Promise<void> {
    await this.db
      .insert(legalDocuments)
      .values(
        LEGAL_TEXTS.map((t) => ({
          kind: t.kind,
          version: t.version,
          title: t.title,
          url: legalDocumentUrl(this.config.PUBLIC_WEB_URL, t.kind, t.version),
          bodySha256: bodySha256(t.body),
          effectiveFrom: new Date(t.effectiveFrom),
        })),
      )
      .onConflictDoUpdate({
        target: [legalDocuments.kind, legalDocuments.version],
        set: { url: sql`excluded.url`, updatedAt: new Date() },
        setWhere: sql`${legalDocuments.url} IS DISTINCT FROM excluded.url`,
      });
  }

  /** Текст любой опубликованной версии (страница документа в вебе); неизвестная версия — 404. */
  async documentText(kind: LegalDocumentKind, version: string): Promise<Schema<"LegalDocumentText">> {
    const [doc] = await this.db
      .select()
      .from(legalDocuments)
      .where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.version, version)));
    const text = doc && legalText(doc.kind, doc.version);
    if (!doc || !text) throw notFound();
    return { ...toDocument(doc), body: [...text.body], bodySha256: doc.bodySha256 ?? bodySha256(text.body) };
  }

  /** По одной действующей версии каждого вида: последняя с effective_from ≤ сейчас. */
  async currentDocuments(kind?: LegalDocumentKind): Promise<DocumentRow[]> {
    const rows = await this.db
      .select()
      .from(legalDocuments)
      .where(and(lte(legalDocuments.effectiveFrom, new Date()), kind ? eq(legalDocuments.kind, kind) : undefined))
      .orderBy(legalDocuments.kind, desc(legalDocuments.effectiveFrom), desc(legalDocuments.version));
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.kind) ? false : (seen.add(r.kind), true)));
  }

  async listCurrent(kind?: LegalDocumentKind): Promise<Schema<"LegalDocumentList">> {
    return { items: (await this.currentDocuments(kind)).map(toDocument) };
  }

  async currentText(kind: LegalDocumentKind): Promise<CurrentDocumentText | undefined> {
    const [doc] = await this.currentDocuments(kind);
    const text = doc && legalText(doc.kind, doc.version);
    return doc && text ? { id: doc.id, kind: doc.kind, version: doc.version, title: doc.title, body: text.body } : undefined;
  }

  /**
   * Какие обязательные документы взрослый ещё не принял (детям и сотрудникам — ничего). Вид без действующей версии
   * (справочник пуст) считается непринятым: клиент ведёт на шаг условий, а не дальше.
   */
  async pendingKinds(accountId: string, kind: Principal["kind"]): Promise<LegalDocumentKind[]> {
    if (kind !== "adult") return [];
    const current = (await this.currentDocumentsEnsured()).filter((d) => ADULT_REQUIRED_KINDS.includes(d.kind));
    const missing = ADULT_REQUIRED_KINDS.filter((k) => !current.some((d) => d.kind === k));
    if (current.length === 0) return [...missing];
    const accepted = await this.db
      .select({ documentId: consents.documentId })
      .from(consents)
      .where(
        and(
          eq(consents.subjectAccountId, accountId),
          isNull(consents.revokedAt),
          inArray(
            consents.documentId,
            current.map((d) => d.id),
          ),
        ),
      );
    const ok = new Set(accepted.map((a) => a.documentId));
    return [...current.filter((d) => !ok.has(d.id)).map((d) => d.kind), ...missing];
  }

  /** Электронное согласие взрослого: только действующие версии, повтор идемпотентен, каждое — в аудит. */
  async accept(principal: Principal, documentIds: string[], meta: RequestMeta, attempt = 0): Promise<Schema<"ConsentList">> {
    if (principal.kind === "child") throw forbidden();
    try {
      return await this.acceptOnce(principal, documentIds, meta);
    } catch (e) {
      // Два одновременных принятия одной версии: второе видит запись первого и отвечает тем же (идемпотентно).
      if (pgErrorCode(e) === "23505" && attempt < 2) return this.accept(principal, documentIds, meta, attempt + 1);
      throw e;
    }
  }

  private async acceptOnce(principal: Principal, documentIds: string[], meta: RequestMeta): Promise<Schema<"ConsentList">> {
    const rows = await this.currentDocumentsEnsured();
    if (rows.length === 0) throw unavailable("documents_unavailable");
    const current = new Map(rows.map((d) => [d.id, d]));
    const docs = documentIds.map((id) => current.get(id));
    if (docs.some((d) => !d)) throw conflict("document_not_current");
    const items = await this.db.transaction(async (tx) => {
      const out: Consent[] = [];
      for (const doc of docs as DocumentRow[]) {
        const [existing] = await tx
          .select()
          .from(consents)
          .where(and(eq(consents.subjectAccountId, principal.accountId), eq(consents.documentId, doc.id), isNull(consents.revokedAt)));
        if (existing) {
          out.push(this.toConsent(existing, doc));
          continue;
        }
        const [row] = await tx
          .insert(consents)
          .values({ documentId: doc.id, method: "electronic", subjectAccountId: principal.accountId, givenByAccountId: principal.accountId })
          .returning();
        await this.audit.record(tx, {
          action: "consent.given",
          actor: principal,
          target: { type: "consent", id: row!.id },
          metadata: { documentKind: doc.kind, documentVersion: doc.version, method: "electronic" },
          meta,
        });
        out.push(this.toConsent(row!, doc));
      }
      return out;
    });
    return { items };
  }

  /** Бумажное согласие родителя на место ученика: отмечает учитель класса (сам бланк хранится в школе). */
  async recordPaper(
    principal: Principal,
    classId: string,
    seatNumber: number,
    body: { documentId?: string; signedOn?: string },
    meta: RequestMeta,
  ): Promise<Consent> {
    const seat = await this.classes.requireTeacherSeat(principal, classId, seatNumber);
    let doc: DocumentRow | undefined;
    if (body.documentId) {
      [doc] = await this.db.select().from(legalDocuments).where(eq(legalDocuments.id, body.documentId));
      if (!doc || doc.kind !== "consent_child") throw invalidField("/documentId", "Нужна версия бланка согласия родителя (consent_child)");
    } else {
      [doc] = (await this.currentDocumentsEnsured()).filter((d) => d.kind === "consent_child");
      if (!doc) throw unavailable("documents_unavailable");
    }
    // Даты — учебные сутки по Уфе (вся республика в UTC+5): подпись позже сегодняшних суток — в будущем.
    const today = ufaToday();
    const signedOn = body.signedOn ?? today;
    if (signedOn > today) throw invalidField("/signedOn", "Дата подписи не может быть в будущем");
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(consents)
          .values({
            documentId: doc.id,
            method: "paper",
            subjectSeatId: seat.seatId,
            subjectClassId: classId,
            givenByAccountId: principal.accountId,
            signedOn,
          })
          .returning();
        await this.audit.record(tx, {
          action: "consent.given",
          actor: principal,
          target: { type: "consent", id: row!.id },
          metadata: { documentKind: doc.kind, documentVersion: doc.version, method: "paper", seatNumber },
          meta,
        });
        return this.toConsent(row!, doc, seatNumber);
      });
    } catch (e) {
      if (pgErrorCode(e) === "23505") throw conflict("consent_exists");
      throw e;
    }
  }

  /**
   * Отзыв согласия (политика consent-owner). Отзыв бумажного согласия блокирует вход на место (consent_revoked —
   * и по карточке, и выдачу сессии по заявке кода класса), завершает текущие сессии ученика этого места и закрывает
   * выдачу по его заявкам (ACCOUNTS_PORT.revokeAllSessions). Всё — под блокировкой места (lockSeat), той же,
   * что у входа: вход не проскакивает «между» отзывом согласия и отзывом сессий.
   */
  async revoke(principal: Principal, consentId: string, meta: RequestMeta): Promise<Consent> {
    const [row] = await this.db.select().from(consents).where(eq(consents.id, consentId));
    if (!row) throw notFound();
    const owner =
      row.method === "electronic"
        ? row.subjectAccountId === principal.accountId
        : row.subjectClassId !== null && (await this.classes.isClassTeacher(principal, row.subjectClassId));
    if (!owner) throw forbidden();
    if (row.revokedAt) throw conflict("consent_already_revoked");
    const [doc] = await this.db.select().from(legalDocuments).where(eq(legalDocuments.id, row.documentId));
    let revokedFamilies: string[] = [];
    const result = await this.db.transaction(async (tx) => {
      // Ученик места — уже под блокировкой: вход, закончившийся до неё, мог только что занять пустое место.
      if (row.subjectSeatId) await this.classes.lockSeat(tx, row.subjectSeatId);
      const seat = row.subjectSeatId ? await this.classes.seatInfo(row.subjectSeatId, tx) : undefined;
      const [updated] = await tx
        .update(consents)
        .set({ revokedAt: new Date(), revokedByAccountId: principal.accountId })
        .where(and(eq(consents.id, consentId), isNull(consents.revokedAt)))
        .returning();
      if (!updated) throw conflict("consent_already_revoked");
      await this.audit.record(tx, {
        action: "consent.revoked",
        actor: principal,
        target: { type: "consent", id: consentId },
        metadata: { documentKind: doc!.kind, documentVersion: doc!.version, method: row.method, ...(seat ? { seatNumber: seat.seatNumber } : {}) },
        meta,
      });
      if (seat?.accountId && !(await this.hasActiveSeatConsent(tx, row.subjectSeatId!))) {
        revokedFamilies = await this.accounts.revokeAllSessions(tx, seat.accountId, "consent_revoked");
      }
      return this.toConsent(updated, doc!, seat?.seatNumber);
    });
    // Стоп-лист — после фиксации отзыва в базе: сбой Valkey не откатывает отзыв, а даёт 503.
    await this.accounts.blockSessions(revokedFamilies);
    return result;
  }

  /** Последнее бумажное согласие каждого места (действующее важнее отозванного); `db` — читать в транзакции. */
  async seatConsents(seatIds: readonly string[], db: Db = this.db): Promise<Map<string, SeatConsent>> {
    const out = new Map<string, SeatConsent>();
    if (seatIds.length === 0) return out;
    const rows = await db
      .select({ c: consents, version: legalDocuments.version })
      .from(consents)
      .innerJoin(legalDocuments, eq(legalDocuments.id, consents.documentId))
      .where(inArray(consents.subjectSeatId, [...seatIds]))
      .orderBy(desc(consents.givenAt));
    for (const { c, version } of rows) {
      const prev = out.get(c.subjectSeatId!);
      if (prev && (prev.status === "given" || c.revokedAt)) continue;
      out.set(c.subjectSeatId!, {
        consentId: c.id,
        status: c.revokedAt ? "revoked" : "given",
        documentVersion: version,
        givenAt: c.givenAt.toISOString(),
        ...(c.revokedAt ? { revokedAt: c.revokedAt.toISOString() } : {}),
      });
    }
    return out;
  }

  /** Вход на место заблокирован: согласие места было и отозвано, действующего нет (ADR 0016 §5). */
  async isSeatBlocked(seatId: string, db: Db = this.db): Promise<boolean> {
    return (await this.seatConsents([seatId], db)).get(seatId)?.status === "revoked";
  }

  /** Есть ли у взрослого действующие согласия на все обязательные документы; справочник пуст — 503. */
  async hasAcceptedRequired(accountId: string): Promise<boolean> {
    await this.requiredDocuments();
    return (await this.pendingKinds(accountId, "adult")).length === 0;
  }

  private async hasActiveSeatConsent(db: Db, seatId: string): Promise<boolean> {
    const rows = await db
      .select({ id: consents.id })
      .from(consents)
      .where(and(eq(consents.subjectSeatId, seatId), isNull(consents.revokedAt)))
      .limit(1);
    return rows.length > 0;
  }

  private toConsent(row: ConsentRow, doc: DocumentRow, seatNumber?: number): Consent {
    return {
      id: row.id,
      document: { id: doc.id, kind: doc.kind, version: doc.version },
      method: row.method,
      status: row.revokedAt ? "revoked" : "given",
      subject:
        row.method === "electronic"
          ? { type: "account", accountId: row.subjectAccountId! }
          : { type: "seat", classId: row.subjectClassId!, ...(seatNumber !== undefined ? { seatNumber } : {}) },
      givenAt: row.givenAt.toISOString(),
      ...(row.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : {}),
    };
  }
}
