"use client";

import { useEffect, useId, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, EmptyState, Skeleton, SkeletonGroup } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem, isNetworkError } from "@teletau/session/problem";
import { ConsoleShell } from "../_components/ConsoleShell";

type Entry = Schema<"AuditEntry">;

/** Базовые действия аудита (ADR 0017 §5). Неизвестное действие показывается как есть. */
const ACTIONS: Record<string, string> = {
  "card.issued": "Выпуск карточек",
  "card.reissued": "Перевыпуск карточки",
  "class.join_code_issued": "Выпуск кода класса",
  "class.join_code_closed": "Код класса погашен",
  "join_request.approved": "Заявка на вход одобрена",
  "join_request.rejected": "Заявка на вход отклонена",
  "teacher_verification.submitted": "Заявка учителя подана",
  "teacher_verification.approved": "Заявка учителя одобрена",
  "teacher_verification.rejected": "Заявка учителя отклонена",
  "consent.given": "Согласие дано",
  "consent.revoked": "Согласие отозвано",
  "session.refresh_reuse_detected": "Повтор refresh-токена: сессия отозвана",
  "session.device_mismatch": "Чужое устройство: сессия отозвана",
  "staff.login": "Вход сотрудника",
  "staff.login_failed": "Неудачный вход сотрудника",
};

const KIND: Record<Schema<"AccountKind">, string> = { child: "ученик", adult: "взрослый", staff: "сотрудник" };
/** Роли RBAC (ADR 0017) по-русски. Неизвестная роль (список в контракте расширяется) — как есть. */
const ROLE: Record<Schema<"Role">, string> = { student: "ученик", teacher: "учитель", moderator: "модератор", admin: "администратор" };
const roleName = (role: string) => ROLE[role as Schema<"Role">] ?? role;
const PAGE = 50;
const fmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Yekaterinburg" });
const short = (id?: string) => (id ? `…${id.slice(-8)}` : "");

function metadataText(m: Entry["metadata"]): string {
  if (!m) return "";
  return Object.entries(m)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default function AuditPage() {
  return <ConsoleShell section="audit">{() => <AuditLog />}</ConsoleShell>;
}

/** Журнал аудита (только чтение): новые сверху, фильтр по действию, постраничный переход по курсорам. */
function AuditLog() {
  const selectId = useId();
  const [action, setAction] = useState("");
  // Курсоры пройденных страниц: назад — по стеку, вперёд — по nextCursor.
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  // Страница — вместе с тем, для какого запроса она загружена: сразу после перехода на экране не остаётся прежняя
  // страница с её кнопками, и второе нажатие не перелистывает ещё раз.
  const [loaded, setLoaded] = useState<{ key: string; page: Schema<"AuditLogPage"> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const cursor = stack[stack.length - 1];
  const depth = stack.length;
  const key = `${tick}|${action}|${stack.length}|${cursor ?? ""}`;
  const data = loaded?.key === key ? loaded.page : null;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    unwrap(api.GET("/api/v1/admin/audit-log", { params: { query: { limit: PAGE, ...(action ? { action } : {}), ...(cursor ? { cursor } : {}) } } }))
      .then((page) => !cancelled && setLoaded({ key, page }))
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [action, cursor, tick, key]);

  return (
    <div className="tt-stack tt-stack--loose">
      <header className="console__head">
        <div className="tt-stack tt-stack--tight">
          <h1 className="tt-title2">Журнал аудита</h1>
          <p className="tt-muted">Время — по Уфе.</p>
        </div>
        <div className="tt-field console__filter">
          <label className="tt-field__label" htmlFor={selectId}>
            Действие
          </label>
          <select
            id={selectId}
            className="tt-input"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setStack([undefined]);
            }}
          >
            <option value="">Все действия</option>
            {Object.entries(ACTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error && !data ? (
        <EmptyState
          art={isNetworkError(error) ? "emptyOffline" : "emptyError"}
          headingAs="h2"
          compact
          title={isNetworkError(error) ? "Нет связи" : "Не удалось загрузить"}
          role="alert"
          actions={
            <Button block onClick={() => setTick((n) => n + 1)}>
              Попробовать снова
            </Button>
          }
        >
          {describeProblem(error)}
        </EmptyState>
      ) : !data ? (
        <SkeletonGroup label="Загружаем журнал" className="tt-stack tt-stack--tight">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={48} radius="tile" />
          ))}
        </SkeletonGroup>
      ) : data.items.length === 0 ? (
        <EmptyState art="emptyAllDone" headingAs="h2" compact title="Записей нет" />
      ) : (
        <div className="table-wrap">
          <table className="table table--dense">
            <caption className="tt-visually-hidden">Журнал аудита, страница {stack.length}</caption>
            <thead>
              <tr>
                <th scope="col">Время</th>
                <th scope="col">Действие</th>
                <th scope="col">Кто</th>
                <th scope="col">Объект</th>
                <th scope="col">Подробности</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="table__nowrap">{fmt.format(new Date(e.at))}</td>
                  <td>
                    {ACTIONS[e.action] ?? e.action}
                    <code className="table__sub">{e.action}</code>
                  </td>
                  <td>
                    {e.actor ? (
                      <>
                        {KIND[e.actor.kind]}
                        {e.actor.roles?.length ? `, ${e.actor.roles.map(roleName).join(", ")}` : ""}
                        <code className="table__sub">{short(e.actor.accountId)}</code>
                      </>
                    ) : (
                      "система"
                    )}
                  </td>
                  <td>
                    {e.target ? (
                      <>
                        {e.target.type}
                        <code className="table__sub">{short(e.target.id)}</code>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="table__meta">{metadataText(e.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav className="pager" aria-label="Страницы журнала">
            {/* Переход — от страницы, на которой нажали: двойное нажатие не перелистывает дважды. */}
            <Button small variant="secondary" icon={<CaretLeft weight="bold" />} disabled={depth === 1} onClick={() => setStack((s) => (s.length === depth ? s.slice(0, -1) : s))}>
              Более новые
            </Button>
            <span className="tt-muted" aria-live="polite">
              Страница {stack.length}
            </span>
            <Button small variant="secondary" disabled={!data.nextCursor} onClick={() => setStack((s) => (s.length === depth ? [...s, data.nextCursor] : s))}>
              Более ранние
              <CaretRight weight="bold" aria-hidden />
            </Button>
          </nav>
        </div>
      )}
    </div>
  );
}
