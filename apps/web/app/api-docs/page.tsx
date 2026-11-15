import type { Metadata } from "next";
import { CaretDown, DownloadSimple } from "@phosphor-icons/react/ssr";
import { Brand, ThemeToggleButton, buttonClass, illustrations } from "@teletau/ui";
import { plural } from "../_components/learn/format";
import { dictionaryExample, leaderboardExample, phraseExample } from "./examples";
import { Fields, Md, Method, OperationFacts, OperationRow, PathText, SchemaBody, firstLine, schemaKind } from "./render";
import { endpointById, endpoints, endpointsByTag, schemaAnchor, sharedResponseCodes, spec, type SchemaObject } from "./spec";
import "./api-docs.css";

export const metadata: Metadata = {
  title: "Документация API",
  description: "Открытый API ТелеТау: выгрузка словаря, доска почёта, фраза дня и все операции платформы.",
};

/** Стенд API: страница описывает его, а не адрес, с которым запущен этот сайт. */
const API_ORIGIN = "https://api.teletau.study";

/** Открытые данные по ТЗ: операция, схема полей и пример ответа, ссылки на живой ответ стенда. */
const OPEN_DATA: {
  operationId: string;
  title: string;
  fields: { title: string; schema: string };
  example: unknown;
  links: { label: string; query: string }[];
}[] = [
  {
    operationId: "getPublicDictionary",
    title: "Выгрузка словаря",
    fields: { title: "Поля записи", schema: "PublicDictionaryEntry" },
    example: dictionaryExample,
    links: [
      { label: "Открыть JSON", query: "" },
      { label: "Скачать CSV", query: "?format=csv" },
    ],
  },
  {
    operationId: "getPublicLeaderboard",
    title: "Доска почёта",
    fields: { title: "Поля ответа", schema: "PublicLeaderboard" },
    example: leaderboardExample,
    links: [{ label: "Открыть JSON", query: "" }],
  },
  {
    operationId: "getPhraseOfDay",
    title: "Фраза дня",
    fields: { title: "Поля ответа", schema: "PhraseOfDay" },
    example: phraseExample,
    links: [{ label: "Открыть JSON", query: "" }],
  },
];

function OpenDataCard({ item }: { item: (typeof OPEN_DATA)[number] }) {
  const { method, path, op } = endpointById(item.operationId);
  const titleId = `key-${item.operationId}-title`;
  return (
    <article className="ad-key" id={`key-${item.operationId}`} aria-labelledby={titleId}>
      <div className="ad-key__head">
        <h3 id={titleId} className="ad-key__title">
          {item.title}
        </h3>
        <p className="ad-endpoint">
          <Method method={method} />
          <PathText path={path} />
        </p>
        <p className="ad-key__links">
          {item.links.map((link) => (
            <a key={link.label} className={buttonClass({ variant: "secondary", small: true })} href={`${API_ORIGIN}${path}${link.query}`}>
              {link.label}
            </a>
          ))}
        </p>
      </div>
      {op.description ? <Md className="ad-op__desc" text={op.description} /> : null}
      <OperationFacts op={op} />
      <div className="ad-key__part">
        <h4 className="ad-h4">{item.fields.title}</h4>
        <Fields schema={spec.components.schemas[item.fields.schema] as SchemaObject} />
      </div>
      <div className="ad-key__part">
        <h4 className="ad-h4">Пример ответа</h4>
        <pre className="ad-example">
          <code>{JSON.stringify(item.example, null, 2)}</code>
        </pre>
      </div>
    </article>
  );
}

/** Документация API: вступление, открытые данные по ТЗ, все операции по тегам, схемы. Страница целиком серверная. */
export default function ApiDocsPage() {
  const groups = endpointsByTag();
  const schemas = Object.entries(spec.components.schemas);
  const errors = sharedResponseCodes();
  const bee = illustrations.beeRead;
  const ops = endpoints.length;

  return (
    <div className="ad">
      <header className="ad-top">
        <div className="ad-wrap ad-top__in">
          <Brand subtitle="API" />
          <ThemeToggleButton />
        </div>
      </header>

      <main id="main" className="ad-wrap ad-layout">
        <header className="ad-intro">
          <div className="ad-intro__text">
            <p className="tt-kicker">
              OpenAPI {spec.openapi} · версия {spec.info.version} · {ops} {plural(ops, ["операция", "операции", "операций"])}
            </p>
            <h1 className="ad-title">Документация API</h1>
            <div className="ad-base">
              <p className="ad-label">Базовый адрес</p>
              <p className="ad-base__url">
                <span className="ad-base__seg">{API_ORIGIN}</span>
                <wbr />
                <span className="ad-base__seg">/api/v1</span>
              </p>
              <p className="ad-base__files">
                <a className={buttonClass({ small: true })} href="/api-docs/openapi.yaml" download>
                  <DownloadSimple weight="bold" aria-hidden />
                  Скачать openapi.yaml
                </a>
                <a className={buttonClass({ variant: "secondary", small: true })} href="/api-docs/openapi.json">
                  openapi.json
                </a>
              </p>
            </div>
            <p className="ad-text">
              Публичные операции работают без входа. Остальным нужна сессия: access-токен в заголовке{" "}
              <code className="ad-code">Authorization: Bearer</code>.
            </p>
            <p className="ad-text">
              Кому доступна операция, указано в строке «Доступ» (<code className="ad-code">x-access</code>). Подробнее в{" "}
              <code className="ad-code">docs/07-data-and-api.md</code>.
            </p>
          </div>
          <img className="ad-intro__art" src={bee.src} width={bee.width} height={bee.height} alt="" />
          <div className="ad-intro__more">
            {spec.info.description ? (
              <details className="ad-more">
                <summary className="ad-more__summary">
                  Соглашения
                  <CaretDown weight="bold" aria-hidden className="ad-caret" />
                </summary>
                <div className="ad-more__body">
                  <Md text={spec.info.description} />
                </div>
              </details>
            ) : null}
            <details className="ad-more">
              <summary className="ad-more__summary">
                Ошибки
                <CaretDown weight="bold" aria-hidden className="ad-caret" />
              </summary>
              <div className="ad-more__body" id="errors">
                <ul className="ad-responses">
                  {errors.map((e) => (
                    <li key={e.name} className="ad-response">
                      <span className="ad-status ad-status--error">{e.code}</span>
                      <div className="ad-response__body">
                        <Md text={e.response.description} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
        </header>

        <nav className="ad-nav" aria-label="Разделы">
          <ul className="ad-nav__list">
            <li>
              <a className="ad-nav__link ad-nav__link--key" href="#open-data">
                Открытые данные
              </a>
            </li>
            {groups.map((g) => (
              <li key={g.name}>
                <a className="ad-nav__link" href={`#tag-${g.name}`}>
                  {g.name}
                  <span className="ad-nav__count" aria-hidden>
                    {g.endpoints.length}
                  </span>
                </a>
              </li>
            ))}
            <li>
              <a className="ad-nav__link" href="#schemas">
                Схемы
                <span className="ad-nav__count" aria-hidden>
                  {schemas.length}
                </span>
              </a>
            </li>
          </ul>
        </nav>

        <div className="ad-body">
          <section id="open-data" className="ad-section" aria-labelledby="open-data-title">
            <div className="ad-section__head">
              <h2 id="open-data-title" className="ad-h2">
                Открытые данные
              </h2>
              <p className="ad-text">Без входа и ключей.</p>
            </div>
            <div className="ad-ops">
              {OPEN_DATA.map((item) => (
                <OpenDataCard key={item.operationId} item={item} />
              ))}
            </div>
          </section>

          {groups.map((g) => (
            <section key={g.name} id={`tag-${g.name}`} className="ad-section" aria-labelledby={`tag-${g.name}-title`}>
              <div className="ad-section__head">
                <h2 id={`tag-${g.name}-title`} className="ad-h2">
                  {g.name}
                </h2>
                {g.description ? <Md className="ad-text" text={g.description} /> : null}
              </div>
              <div className="ad-oplist">
                {g.endpoints.map((e) => (
                  <OperationRow key={e.op.operationId} endpoint={e} />
                ))}
              </div>
            </section>
          ))}

          <section id="schemas" className="ad-section" aria-labelledby="schemas-title">
            <div className="ad-section__head">
              <h2 id="schemas-title" className="ad-h2">
                Схемы
              </h2>
            </div>
            <div className="ad-schemas">
              {schemas.map(([name, schema]) => (
                <details key={name} className="ad-schema">
                  <summary className="ad-schema__summary">
                    <code className="ad-schema__name">{name}</code>
                    <span className="ad-schema__kind">{schemaKind(schema)}</span>
                    <span className="ad-schema__line">{firstLine(schema.description)}</span>
                    <CaretDown weight="bold" aria-hidden className="ad-caret" />
                  </summary>
                  {/* Якорь — внутри: переход по ссылке на схему раскрывает блок (поиск по странице — тоже). */}
                  <div className="ad-schema__body" id={schemaAnchor(name)}>
                    <SchemaBody schema={schema} />
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
