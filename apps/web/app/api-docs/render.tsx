// Части страницы документации API: описание с разметкой, путь, тип схемы, поля, параметры, ответы, операция.
// Только серверные компоненты: страница уходит в браузер готовым HTML.
import { Fragment, type ReactNode } from "react";
import { CaretDown, Key, LockSimple, LockSimpleOpen } from "@phosphor-icons/react/ssr";
import {
  codeOrder,
  parameterOf,
  refName,
  requestBodyOf,
  responseOf,
  schemaAnchor,
  type Endpoint,
  type MediaType,
  type Operation,
  type Parameter,
  type SchemaObject,
} from "./spec";

// ───────────── описание: абзацы, списки «- », `код` и **жирный** ─────────────

type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[][] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let current: Block | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      current = null;
      continue;
    }
    const item = /^\s*- (.*)$/.exec(line);
    if (item) {
      if (current?.kind !== "ul") {
        current = { kind: "ul", items: [] };
        out.push(current);
      }
      current.items.push([item[1] ?? ""]);
    } else if (current?.kind === "ul" && /^\s/.test(line)) {
      current.items.at(-1)?.push(line.trim());
    } else if (current?.kind === "p") {
      current.lines.push(line.trim());
    } else {
      current = { kind: "p", lines: [line.trim()] };
      out.push(current);
    }
  }
  return out;
}

function inline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={i} className="ad-code">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      return part;
    });
}

/** Описание из контракта: строки абзаца склеиваются, «- » — пункты списка. */
export function Md({ text, className }: { text: string; className?: string }) {
  return (
    <div className={["ad-md", className].filter(Boolean).join(" ")}>
      {blocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{inline(b.lines.join(" "))}</p>
        ) : (
          <ul key={i}>
            {b.items.map((lines, j) => (
              <li key={j}>{inline(lines.join(" "))}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/** Первая строка описания без разметки — подпись в свёрнутой схеме. */
export function firstLine(text: string | undefined): string {
  return (text ?? "").split("\n")[0]?.replace(/`|\*\*/g, "").trim() ?? "";
}

// ───────────── путь и метод ─────────────

/**
 * Путь операции: каждый сегмент «/имя» — отдельный блок строки. Длинный путь переносится между сегментами,
 * а не внутри слова; сегмент длиннее строки (крупный шрифт на узком экране) переносится внутри себя.
 */
export function PathText({ path }: { path: string }) {
  const segments = path.split("/").filter(Boolean);
  return (
    <span className="ad-path">
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          <span className="ad-path__seg">
            /{/^\{.+\}$/.test(segment) ? <span className="ad-path__param">{segment}</span> : segment}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export function Method({ method }: { method: string }) {
  return <span className="ad-method">{method.toUpperCase()}</span>;
}

// ───────────── тип схемы ─────────────

function joined(nodes: ReactNode[], separator: string): ReactNode {
  return nodes.map((node, i) => (
    <Fragment key={i}>
      {i > 0 ? separator : null}
      {node}
    </Fragment>
  ));
}

export function SchemaLink({ name }: { name: string }) {
  return (
    <a className="ad-ref" href={`#${schemaAnchor(name)}`}>
      {name}
    </a>
  );
}

/** Тип одной строкой: ссылка на схему, `string · uuid`, `Name[]`, `A | B`. */
export function TypeLabel({ schema }: { schema: SchemaObject }): ReactNode {
  if (schema.$ref) return <SchemaLink name={refName(schema.$ref)} />;
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants) return joined(variants.map((v, i) => <TypeLabel key={i} schema={v} />), " | ");
  if (schema.allOf) return joined(schema.allOf.map((v, i) => <TypeLabel key={i} schema={v} />), " & ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [schema.properties ? "object" : "any"];
  return joined(
    types.map((t) => {
      if (t === "array") return <>{schema.items ? <TypeLabel schema={schema.items} /> : "any"}[]</>;
      if (t === "object" && typeof schema.additionalProperties === "object") {
        return (
          <>
            map&lt;string, <TypeLabel schema={schema.additionalProperties} />&gt;
          </>
        );
      }
      return schema.format ? `${t} · ${schema.format}` : t;
    }),
    " | ",
  );
}

// ───────────── значения и ограничения ─────────────

const range = (min: number | undefined, max: number | undefined): string | null => {
  if (min !== undefined && max !== undefined) return min === max ? `${min}` : `${min}–${max}`;
  if (min !== undefined) return `от ${min}`;
  if (max !== undefined) return `до ${max}`;
  return null;
};

function limits(s: SchemaObject): ReactNode[] {
  const out: ReactNode[] = [];
  const value = range(s.minimum, s.maximum);
  if (value) out.push(value);
  const length = range(s.minLength, s.maxLength);
  if (length) out.push(`длина ${length}`);
  const items = range(s.minItems, s.maxItems);
  if (items) out.push(`элементов ${items}`);
  if (s.uniqueItems) out.push("без повторов");
  if (s.minProperties !== undefined) out.push(`полей от ${s.minProperties}`);
  if (s.pattern) {
    out.push(
      <>
        шаблон <code className="ad-code">{s.pattern}</code>
      </>,
    );
  }
  if (s.default !== undefined) {
    out.push(
      <>
        по умолчанию <code className="ad-code">{JSON.stringify(s.default)}</code>
      </>,
    );
  }
  return out;
}

/** Допустимые значения (enum) и ограничения поля одной строкой. */
function Values({ schema }: { schema: SchemaObject }) {
  const own = schema.enum ?? schema["x-extensible-enum"];
  const items = schema.items && !schema.items.$ref ? (schema.items.enum ?? schema.items["x-extensible-enum"]) : undefined;
  const values = own ?? items;
  const rest = limits(schema);
  if (!values && rest.length === 0) return null;
  return (
    <div className="ad-values">
      {values ? (
        <span className="ad-values__list">
          {values.map((v) => (
            <code key={String(v)} className="ad-code">
              {String(v)}
            </code>
          ))}
          {schema["x-extensible-enum"] || schema.items?.["x-extensible-enum"] ? <span className="ad-values__note">список расширяется</span> : null}
        </span>
      ) : null}
      {rest.map((r, i) => (
        <span key={i} className="ad-values__note">
          {r}
        </span>
      ))}
    </div>
  );
}

// ───────────── поля схемы ─────────────

/** Вложенная схема без ссылки — её поля показываются тут же, с отступом. */
function inlineObject(s: SchemaObject): SchemaObject | null {
  if (s.$ref) return null;
  if (s.properties) return s;
  if (s.items && !s.items.$ref && s.items.properties) return s.items;
  return null;
}

function Required() {
  return <span className="ad-req">обязательно</span>;
}

export function Fields({ schema, depth = 0 }: { schema: SchemaObject; depth?: number }) {
  if (!schema.properties) return null;
  const required = new Set(schema.required ?? []);
  return (
    <ul className="ad-fields">
      {Object.entries(schema.properties).map(([name, s]) => {
        const nested = depth < 3 ? inlineObject(s) : null;
        return (
          <li key={name} className="ad-field">
            <div className="ad-field__head">
              <code className="ad-field__name">{name}</code>
              <span className="ad-type">
                <TypeLabel schema={s} />
              </span>
              {required.has(name) ? <Required /> : null}
            </div>
            {s.description ? <Md className="ad-field__desc" text={s.description} /> : null}
            <Values schema={s} />
            {nested ? <Fields schema={nested} depth={depth + 1} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Содержимое схемы в разделе «Схемы»: описание, поля, варианты или значения. */
export function SchemaBody({ schema }: { schema: SchemaObject }) {
  const variants = schema.oneOf ?? schema.anyOf;
  const mapping = schema.discriminator?.mapping;
  return (
    <>
      {schema.description ? <Md className="ad-schema__desc" text={schema.description} /> : null}
      {schema.properties ? <Fields schema={schema} /> : null}
      {variants ? (
        <div className="ad-variants">
          <p className="ad-label">{schema.discriminator ? `Вариант по полю ${schema.discriminator.propertyName}` : "Один из вариантов"}</p>
          <ul className="ad-variants__list">
            {mapping
              ? Object.entries(mapping).map(([value, ref]) => (
                  <li key={value}>
                    <code className="ad-code">{value}</code> <SchemaLink name={refName(ref)} />
                  </li>
                ))
              : variants.map((v, i) => (
                  <li key={i}>
                    <TypeLabel schema={v} />
                  </li>
                ))}
          </ul>
        </div>
      ) : null}
      {!schema.properties && !variants ? (
        <div className="ad-schema__type">
          <span className="ad-type">
            <TypeLabel schema={schema} />
          </span>
          <Values schema={schema} />
        </div>
      ) : null}
    </>
  );
}

/** Короткий вид схемы для заголовка свёрнутого блока. */
export function schemaKind(schema: SchemaObject): string {
  if (schema.oneOf || schema.anyOf) return "oneOf";
  if (schema.enum || schema["x-extensible-enum"]) return "enum";
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return schema.type ?? (schema.properties ? "object" : "any");
}

// ───────────── параметры, тело, ответы ─────────────

const PARAM_IN: Record<Parameter["in"], string> = {
  path: "в пути",
  query: "в запросе",
  header: "заголовок",
  cookie: "cookie",
};

export function Params({ params }: { params: Parameter[] }) {
  return (
    <ul className="ad-fields">
      {params.map((p) => (
        <li key={`${p.in}-${p.name}`} className="ad-field">
          <div className="ad-field__head">
            <code className="ad-field__name">{p.name}</code>
            <span className="ad-field__in">{PARAM_IN[p.in]}</span>
            {p.schema ? (
              <span className="ad-type">
                <TypeLabel schema={p.schema} />
              </span>
            ) : null}
            {p.required ? <Required /> : null}
          </div>
          {p.description ? <Md className="ad-field__desc" text={p.description} /> : null}
          {p.schema ? <Values schema={p.schema} /> : null}
        </li>
      ))}
    </ul>
  );
}

export const operationParams = (op: Operation): Parameter[] => (op.parameters ?? []).map(parameterOf);

/** Схемы содержимого: JSON — просто тип, другие форматы — с типом содержимого. */
function Media({ content }: { content: Record<string, MediaType> | undefined }) {
  const entries = Object.entries(content ?? {});
  if (entries.length === 0) return null;
  return (
    <span className="ad-media">
      {joined(
        entries.map(([type, media]) => (
          <span key={type} className="ad-media__item">
            {media.schema ? (
              <span className="ad-type">
                <TypeLabel schema={media.schema} />
              </span>
            ) : null}
            {type === "application/json" ? null : <span className="ad-media__type">{type}</span>}
          </span>
        )),
        " ",
      )}
    </span>
  );
}

function Responses({ op }: { op: Operation }) {
  const rows = Object.entries(op.responses)
    .map(([code, r]) => ({ code, ...responseOf(r) }))
    .sort((a, b) => codeOrder(a.code) - codeOrder(b.code));
  const own = rows.filter((r) => !r.shared);
  const shared = rows.filter((r) => r.shared);
  // Общие ответы — ошибки RFC 9457 с одной схемой: коды строкой, расшифровка — во всплывающей подсказке и в «Ошибках».
  const problemRef = shared
    .flatMap((r) => Object.values(r.response.content ?? {}))
    .map((m) => m.schema?.$ref)
    .find(Boolean);
  return (
    <>
      {own.length > 0 ? (
        <ul className="ad-responses">
          {own.map((r) => (
            <li key={r.code} className="ad-response">
              <span className="ad-status">{r.code}</span>
              <div className="ad-response__body">
                <Md text={r.response.description} />
                <Media content={r.response.content} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {shared.length > 0 ? (
        <p className="ad-errors">
          <span className="ad-errors__codes">
            {shared.map((r) => (
              <span key={r.code} className="ad-status ad-status--error">
                {r.code}
              </span>
            ))}
          </span>
          {problemRef ? <SchemaLink name={refName(problemRef)} /> : null}
        </p>
      ) : null}
    </>
  );
}

/** Замок доступа: открытая операция, служебная (секрет сервиса) или по сессии. */
function accessIcon(op: Operation): { open: boolean; Icon: typeof LockSimple; label: string } {
  const access = op["x-access"];
  const open = op.security?.length === 0 || access?.roles.includes("anonymous") === true;
  if (open) return { open, Icon: LockSimpleOpen, label: "Без входа" };
  if (access?.roles.includes("service")) return { open, Icon: Key, label: "Служебная" };
  return { open, Icon: LockSimple, label: "Нужен вход" };
}

function AccessLine({ op }: { op: Operation }) {
  const access = op["x-access"];
  const { open, Icon } = accessIcon(op);
  return (
    <span className="ad-access">
      <Icon weight="bold" aria-hidden className="ad-access__icon" />
      {open ? <span className="ad-access__open">без входа</span> : null}
      {access?.roles
        .filter((r) => r !== "anonymous")
        .map((r) => (
          <code key={r} className="ad-role">
            {r}
          </code>
        ))}
      {access?.policy ? (
        <span className="ad-access__policy">
          политика <code className="ad-role">{access.policy}</code>
        </span>
      ) : null}
    </span>
  );
}

/** Строки «Доступ», «Параметры», «Тело запроса», «Ответы» операции. */
export function OperationFacts({ op, skipParams }: { op: Operation; skipParams?: boolean }) {
  const params = operationParams(op);
  const body = requestBodyOf(op);
  return (
    <dl className="ad-facts">
      <div className="ad-fact">
        <dt>Доступ</dt>
        <dd>
          <AccessLine op={op} />
        </dd>
      </div>
      {params.length > 0 && !skipParams ? (
        <div className="ad-fact">
          <dt>Параметры</dt>
          <dd>
            <Params params={params} />
          </dd>
        </div>
      ) : null}
      {body ? (
        <div className="ad-fact">
          <dt>Тело запроса</dt>
          <dd className="ad-reqbody">
            <Media content={body.content} />
            {body.required ? <Required /> : null}
            {body.description ? <Md className="ad-field__desc" text={body.description} /> : null}
          </dd>
        </div>
      ) : null}
      <div className="ad-fact">
        <dt>Ответы</dt>
        <dd>
          <Responses op={op} />
        </dd>
      </div>
    </dl>
  );
}

/**
 * Операция в полном списке — свёрнутая строка: метод, путь, заголовок (summary) и замок доступа. Раскрытая —
 * описание, доступ, параметры, тело запроса и ответы.
 */
export function OperationRow({ endpoint }: { endpoint: Endpoint }) {
  const { method, path, op } = endpoint;
  const titleId = `op-${op.operationId}-title`;
  const { Icon, label } = accessIcon(op);
  return (
    <article className="ad-op" id={`op-${op.operationId}`} data-op={op.operationId} aria-labelledby={titleId}>
      <details className="ad-op__details">
        <summary className="ad-op__summary">
          <span className="ad-op__head">
            <span className="ad-endpoint">
              <Method method={method} />
              <PathText path={path} />
            </span>
            <h3 id={titleId} className="ad-op__title">
              {op.summary ?? op.operationId}
            </h3>
          </span>
          <Icon weight="bold" className="ad-op__lock" role="img" aria-label={label} />
          <CaretDown weight="bold" aria-hidden className="ad-caret" />
        </summary>
        <div className="ad-op__body">
          {op.description ? <Md className="ad-op__desc" text={op.description} /> : null}
          <OperationFacts op={op} />
        </div>
      </details>
    </article>
  );
}
