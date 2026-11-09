// Выдача сессий по заявкам на вход по коду класса (ADR 0016 §6). Одобренная заявка отдаёт сессию при первом
// опросе, а с устройства заявки — и повторно, до expires_at (ответ с сессией мог потеряться). Когда учитель
// или система отзывают все сессии аккаунта (отзыв согласия, выпуск карточки на место, блокировка), выдачу по его
// заявкам нужно закрыть в той же транзакции — иначе повторный опрос вернул бы отозванный доступ.
//
// Отдельный от JoinService провайдер без зависимостей: его вызывает identity при отзыве всех сессий
// (AccountsService.revokeAllSessions — реализация порта ACCOUNTS_PORT), а JoinService сам зависит от ACCOUNTS_PORT —
// так нет цикла DI. Таблица join_requests остаётся в модуле org (ADR 0014).
import { Injectable } from "@nestjs/common";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../../db/database.js";
import { joinRequests } from "./org.schema.js";

@Injectable()
export class JoinGrants {
  /**
   * Закрывает выдачу сессий по одобренным и уже использованным заявкам аккаунта в транзакции `tx`: срок выдачи
   * (`expires_at`) — «сейчас». Строки заявок блокируются до конца транзакции: опрос, который ждёт эту блокировку,
   * после фиксации видит закрытую заявку. Возвращает число закрытых заявок.
   *
   * Заявки аккаунта ищутся по частичному индексу join_requests_account_grant_idx: вызов идёт под блокировками
   * класса и места при каждом отзыве сессий, а таблица заявок со временем только растёт. Условие по статусу — литералом,
   * как в предикате индекса, чтобы планировщик сопоставил их при любом способе подготовки запроса.
   */
  async close(tx: Db, accountId: string): Promise<number> {
    const rows = await tx
      .update(joinRequests)
      .set({ expiresAt: sql`now()` })
      .where(and(eq(joinRequests.accountId, accountId), sql`${joinRequests.status} IN ('approved', 'consumed')`, gt(joinRequests.expiresAt, sql`now()`)))
      .returning({ id: joinRequests.id });
    return rows.length;
  }
}
