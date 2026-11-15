import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { contractRoles, staffRolesOf, type Principal, type RequestMeta, type Role } from "../../common/auth.js";
import type { OperationQuery } from "../../common/contract.js";
import { hmacHex } from "../../common/crypto.js";
import { decodeCursor, encodeCursor, KeysetCursor, microsIso } from "../../common/cursor.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { auditLog } from "./admin.schema.js";

/** Базовые действия (ADR 0017 §5). Формат `<объект>.<событие>` дополнительно проверяет CHECK в базе. */
export type AuditAction =
  | "card.issued"
  | "card.reissued"
  | "class.join_code_issued"
  /** Учитель погасил действующий код класса до срока. */
  | "class.join_code_closed"
  | "join_request.approved"
  | "join_request.rejected"
  | "teacher_verification.submitted"
  | "teacher_verification.approved"
  | "teacher_verification.rejected"
  | "consent.given"
  | "consent.revoked"
  | "session.refresh_reuse_detected"
  | "session.device_mismatch"
  | "staff.login"
  | "staff.login_failed"
  /** Вход сотрудника заблокирован на час после 10 неверных TOTP за час. */
  | "staff.locked"
  /** ADR 0022: самостоятельный ученик перевыпустил личную карточку — прежняя отозвана, другие сессии завершены. */
  | "login_card.reissued"
  /** ADR 0022: взрослый «Учусь сам» привязал почту — личная карточка отозвана. */
  | "account.email_attached";

/** Значения metadata — только неличные детали: номер места, версия карточки, вид документа (без ПДн и секретов). */
export type AuditMetadata = Record<string, string | number | boolean | null | Array<string | number>>;

export interface AuditRecord {
  action: AuditAction;
  /** Кто совершил действие; нет — система. */
  actor?: Pick<Principal, "accountId" | "kind" | "roles">;
  target?: { type: string; id?: string };
  metadata?: AuditMetadata;
  meta?: RequestMeta;
}

/** Фильтры журнала — query-параметры операции listAuditLog из контракта. */
export type AuditQuery = OperationQuery<"listAuditLog", "limit">;

/** Журнал аудита — только вставка (ADR 0017): модули пишут через этот сервис в своей транзакции. */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Пишет запись в переданной транзакции: изменение без записи в аудит невозможно. */
  async record(db: Db, entry: AuditRecord): Promise<void> {
    await db.insert(auditLog).values({
      actorAccountId: entry.actor?.accountId ?? null,
      actorKind: entry.actor?.kind ?? null,
      actorRoles: entry.actor ? [...entry.actor.roles] : null,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      metadata: entry.metadata ?? {},
      ipHash: entry.meta ? hmacHex(this.config.AUTH_SECRET_PEPPER, `ip:${entry.meta.ip}`) : null,
      requestId: entry.meta?.requestId ?? null,
    });
  }

  /** Страница журнала: новые сверху, курсор — (created_at, id) последней записи. */
  async list(q: AuditQuery): Promise<Schema<"AuditLogPage">> {
    const where: SQL[] = [];
    if (q.action) where.push(eq(auditLog.action, q.action));
    if (q.actorId) where.push(eq(auditLog.actorAccountId, q.actorId));
    if (q.targetType) where.push(eq(auditLog.targetType, q.targetType));
    if (q.targetId) where.push(eq(auditLog.targetId, q.targetId));
    if (q.from) where.push(gte(auditLog.createdAt, new Date(q.from)));
    if (q.to) where.push(lte(auditLog.createdAt, new Date(q.to)));
    // Курсор — момент в микросекундах (точность timestamptz) и id: сравнение кортежем в SQL, без округления до мс в JS.
    const cursor = decodeCursor(q.cursor, KeysetCursor);
    if (cursor) where.push(sql`(${auditLog.createdAt}, ${auditLog.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
    const found = await this.db
      .select({ row: auditLog, at: microsIso(auditLog.createdAt) })
      .from(auditLog)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(q.limit + 1);
    const rows = found.map((f) => f.row);
    const page = rows.slice(0, q.limit);
    const last = found[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        ...(r.actorAccountId && r.actorKind
          ? {
              actor: {
                accountId: r.actorAccountId,
                kind: r.actorKind as Schema<"AccountKind">,
                ...(r.actorRoles ? { roles: contractRoles(r.actorRoles as Role[]) } : {}),
                ...(r.actorRoles && staffRolesOf(r.actorKind as Schema<"AccountKind">, r.actorRoles as Role[])?.length ? { staffRoles: staffRolesOf(r.actorKind as Schema<"AccountKind">, r.actorRoles as Role[]) } : {}),
              },
            }
          : {}),
        ...(r.targetType ? { target: { type: r.targetType, ...(r.targetId ? { id: r.targetId } : {}) } } : {}),
        metadata: r.metadata as Record<string, unknown>,
        ...(r.requestId ? { requestId: r.requestId } : {}),
      })),
      ...(rows.length > q.limit && last ? { nextCursor: encodeCursor({ at: last.at, id: last.row.id }) } : {}),
    };
  }
}
