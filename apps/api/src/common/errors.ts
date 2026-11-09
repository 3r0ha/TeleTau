// Безопасное описание непредвиденной ошибки для лога (CLAUDE.md, правило 5).
// Ошибка запроса к БД несёт в тексте значения параметров (`DrizzleQueryError`: «Failed query: … params: <ФИО, должность…>»),
// а сообщения Postgres — фрагменты введённых данных («invalid input syntax for type uuid: "…"», «Key (email)=(…)»).
// Поэтому для ошибок БД в лог идут только SQLSTATE, имена ограничения, таблицы и столбца и операция («update "pii"."adult_profiles"»),
// а текст сообщения и параметры — никогда. Для прочих ошибок — имя и сообщение через фильтр секретов и строки стека.
import { DrizzleQueryError } from "drizzle-orm";
import { redactString } from "./redact.js";

/** Поля ошибки драйвера pg (DatabaseError), которые не содержат пользовательских значений. */
const PG_SAFE_FIELDS = ["code", "constraint", "table", "column", "dataType", "routine"] as const;

const isPgError = (e: unknown): e is Record<(typeof PG_SAFE_FIELDS)[number] | "severity", unknown> =>
  typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" && /^[0-9A-Z]{5}$/.test((e as { code: string }).code) && "severity" in e;

/** «update "pii"."adult_profiles"», «insert into "sessions"», «select … from "schools"» — без значений и условий. */
export function sqlOperation(query: string): string {
  const verb = /^\s*(\w+)/.exec(query)?.[1]?.toLowerCase() ?? "query";
  const table = /\b(?:into|update|from)\s+("[^"]+"(?:\."[^"]+")?|[A-Za-z_][\w.]*)/i.exec(query)?.[1];
  return table ? `${verb} ${table}` : verb;
}

function pgSummary(e: Record<string, unknown>): string {
  const parts = PG_SAFE_FIELDS.filter((k) => typeof e[k] === "string" && e[k] !== "").map((k) => `${k === "code" ? "SQLSTATE" : k}=${String(e[k])}`);
  return `PostgresError ${parts.join(" ")}`.trim();
}

/** Строки стека «    at …» — без первой строки, в которой лежит сообщение ошибки. */
export function stackFrames(e: unknown, max = 12): string | undefined {
  const stack = e instanceof Error ? e.stack : undefined;
  if (!stack) return undefined;
  const frames = stack
    .split("\n")
    .filter((l) => /^\s+at /.test(l))
    .slice(0, max);
  return frames.length ? redactString(frames.join("\n")) : undefined;
}

/** Описание ошибки без ПДн и секретов: для ошибок БД — только коды и имена, для прочих — имя и сообщение через фильтр. */
export function describeError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur !== undefined && cur !== null && depth < 4; depth++) {
    if (cur instanceof DrizzleQueryError) {
      parts.push(`DrizzleQueryError (${sqlOperation(cur.query)})`);
    } else if (isPgError(cur)) {
      parts.push(pgSummary(cur));
    } else if (cur instanceof Error) {
      // Ошибка pg без severity (обрыв соединения, таймаут) — сообщение без значений; всё равно через фильтр секретов.
      parts.push(`${cur.name}: ${redactString(cur.message).split("\nparams:")[0]}`);
    } else {
      parts.push(`thrown ${typeof cur}`);
      break;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" ← caused by ");
}
