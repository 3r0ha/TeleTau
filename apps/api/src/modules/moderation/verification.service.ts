import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import type { Principal, RequestMeta } from "../../common/auth.js";
import { decodeCursor, encodeCursor, KeysetCursor } from "../../common/cursor.js";
import { ACCOUNTS_PORT, type AccountsPort, type TeacherSchoolPort } from "../../common/ports.js";
import { conflict, forbidden, notFound } from "../../common/problem.js";
import { normalizePersonName, normalizePosition, normalizeTextField } from "../../common/text.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { AuditService } from "../admin/index.js";
import { ConsentService } from "../consent/index.js";
import { DirectoryService } from "../org/index.js";
import { teacherVerificationReasons, teacherVerifications } from "./moderation.schema.js";

type VerificationRow = typeof teacherVerifications.$inferSelect;
export type TeacherVerification = Schema<"TeacherVerification">;
export type TeacherStatus = Schema<"TeacherStatus">;

/**
 * Подтверждение учителей (модуль moderation). ФИО и должность — ПДн взрослого: пишутся в pii.adult_profiles
 * через порт identity, здесь — только ссылки на аккаунт и школу и решение модератора.
 */
@Injectable()
export class VerificationService implements TeacherSchoolPort {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly consents: ConsentService,
    private readonly directory: DirectoryService,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
  ) {}

  async submit(principal: Principal, body: Schema<"TeacherVerificationRequest">, meta: RequestMeta): Promise<TeacherVerification> {
    if (principal.kind !== "adult") throw forbidden();
    const latest = await this.latest(principal.accountId);
    if (latest?.status === "approved") throw conflict("already_verified");
    if (latest?.status === "pending") throw conflict("verification_pending");
    if (!(await this.consents.hasAcceptedRequired(principal.accountId))) throw conflict("consent_required");
    if (!(await this.directory.school(body.schoolId))) throw notFound();
    // ФИО и должность могут быть на башкирском: каноническая форма — @teletau/bashkir-text (правило 7).
    // ФИО — только русские и башкирские буквы, пробел, дефис, апостроф; управляющие символы — 422.
    const fullName = normalizePersonName(body.fullName, "/fullName");
    const position = normalizePosition(body.position, "/position");
    try {
      const row = await this.db.transaction(async (tx) => {
        await this.accounts.setTeacherProfile(tx, principal.accountId, { fullName, position });
        const [created] = await tx.insert(teacherVerifications).values({ accountId: principal.accountId, schoolId: body.schoolId }).returning();
        await this.audit.record(tx, {
          action: "teacher_verification.submitted",
          actor: principal,
          target: { type: "teacher_verification", id: created!.id },
          metadata: { schoolId: body.schoolId },
          meta,
        });
        return created!;
      });
      return (await this.views([row]))[0]!;
    } catch (e) {
      if (pgErrorCode(e) === "23505") throw conflict("verification_pending");
      throw e;
    }
  }

  /** Последняя заявка самого взрослого (политика self). */
  async mine(principal: Principal): Promise<TeacherVerification> {
    const row = await this.latest(principal.accountId);
    if (!row) throw notFound();
    return (await this.views([row]))[0]!;
  }

  /** Статус учителя для GET /me. */
  async teacherStatus(accountId: string): Promise<TeacherStatus> {
    const row = await this.latest(accountId);
    if (!row) return "none";
    return row.status === "approved" ? "verified" : row.status;
  }

  /** TeacherSchoolPort: школа из одобренной заявки (для создания класса в org). */
  async approvedSchoolId(accountId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ schoolId: teacherVerifications.schoolId })
      .from(teacherVerifications)
      .where(and(eq(teacherVerifications.accountId, accountId), eq(teacherVerifications.status, "approved")))
      .orderBy(desc(teacherVerifications.decidedAt))
      .limit(1);
    return row?.schoolId;
  }

  /** Очередь модератора: старые заявки сверху, курсор — (created_at, id). */
  async list(q: { status?: Schema<"TeacherVerificationStatus">; cursor?: string; limit: number }): Promise<Schema<"TeacherVerificationPage">> {
    const cursor = decodeCursor(q.cursor, KeysetCursor);
    const after = cursor
      ? or(gt(teacherVerifications.createdAt, new Date(cursor.at)), and(eq(teacherVerifications.createdAt, new Date(cursor.at)), gt(teacherVerifications.id, cursor.id)))
      : undefined;
    const rows = await this.db
      .select()
      .from(teacherVerifications)
      .where(and(eq(teacherVerifications.status, q.status ?? "pending"), after))
      .orderBy(asc(teacherVerifications.createdAt), asc(teacherVerifications.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await this.views(page),
      ...(rows.length > q.limit && last ? { nextCursor: encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) } : {}),
    };
  }

  /** Одобрение: аккаунт получает роль teacher (в следующем access-токене); решение — в аудит. */
  async approve(principal: Principal, id: string, meta: RequestMeta): Promise<TeacherVerification> {
    const row = await this.decide(principal, id, meta, "approved");
    return (await this.views([row]))[0]!;
  }

  /** Отказ с причиной (видна заявителю). Текст причины в аудит не пишется — в нём могут быть ПДн. */
  async reject(principal: Principal, id: string, reason: string, meta: RequestMeta): Promise<TeacherVerification> {
    const row = await this.decide(principal, id, meta, "rejected", normalizeTextField(reason, "/reason", 3, { multiline: true }));
    return (await this.views([row]))[0]!;
  }

  private async decide(principal: Principal, id: string, meta: RequestMeta, status: "approved" | "rejected", reason?: string): Promise<VerificationRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(teacherVerifications).where(eq(teacherVerifications.id, id)).for("update");
      if (!row) throw notFound();
      if (row.status !== "pending") throw conflict("already_decided");
      const [updated] = await tx
        .update(teacherVerifications)
        .set({ status, decidedByAccountId: principal.accountId, decidedAt: new Date() })
        .where(eq(teacherVerifications.id, id))
        .returning();
      // Причина отказа — в схеме pii: в свободном тексте модератора бывают ПДн.
      if (reason !== undefined) await tx.insert(teacherVerificationReasons).values({ verificationId: id, reason });
      if (status === "approved") await this.accounts.grantTeacherRole(tx, row.accountId);
      await this.audit.record(tx, {
        action: status === "approved" ? "teacher_verification.approved" : "teacher_verification.rejected",
        actor: principal,
        target: { type: "teacher_verification", id },
        metadata: { applicantAccountId: row.accountId, schoolId: row.schoolId },
        meta,
      });
      return updated!;
    });
  }

  private async latest(accountId: string): Promise<VerificationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(teacherVerifications)
      .where(eq(teacherVerifications.accountId, accountId))
      .orderBy(desc(teacherVerifications.createdAt))
      .limit(1);
    return row;
  }

  private async views(rows: VerificationRow[]): Promise<TeacherVerification[]> {
    const rejected = rows.filter((r) => r.status === "rejected").map((r) => r.id);
    const [profiles, schools, reasons] = await Promise.all([
      this.accounts.adultProfiles(rows.map((r) => r.accountId)),
      this.directory.schoolRefs(rows.map((r) => r.schoolId)),
      rejected.length
        ? this.db.select().from(teacherVerificationReasons).where(inArray(teacherVerificationReasons.verificationId, rejected))
        : Promise.resolve([]),
    ]);
    const reasonOf = new Map(reasons.map((r) => [r.verificationId, r.reason]));
    return rows.map((r) => {
      const p = profiles.get(r.accountId);
      // Школа заявки есть всегда: справочник не удаляет записи (импорт только добавляет и обновляет). Пропажа —
      // нарушение целостности, и подставлять вместо района чужой идентификатор нельзя — это 500.
      const school = schools.get(r.schoolId);
      if (!school) throw new Error(`teacher verification ${r.id}: school not found in the directory`);
      const decisionReason = reasonOf.get(r.id);
      return {
        id: r.id,
        status: r.status,
        applicant: { accountId: r.accountId, email: p?.email ?? "", fullName: p?.fullName ?? "" },
        school,
        position: p?.position ?? "",
        createdAt: r.createdAt.toISOString(),
        ...(r.decidedAt ? { decidedAt: r.decidedAt.toISOString() } : {}),
        ...(decisionReason ? { decisionReason } : {}),
      };
    });
  }
}
