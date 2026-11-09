import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import createClient from "openapi-fetch";
import type { Schema, paths } from "@teletau/contracts";
import { ButtonLink, Card, EmptyState } from "@teletau/ui";
import { API_BASE_URL } from "@teletau/session/config";
import { Screen, SimpleTop } from "../../../_components/screens";

type Kind = Schema<"LegalDocumentKind">;
type LegalText = Schema<"LegalDocumentText">;

// Текст читается из API при каждом запросе: источник один — модуль consent (apps/api/src/modules/consent/legal-texts.ts),
// а LegalDocument.url указывает сюда.
export const dynamic = "force-dynamic";

const KINDS: readonly Kind[] = ["terms", "privacy", "consent_adult", "consent_child"];
const VERSION_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const BRAND = "ТелеТау";
const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Yekaterinburg" });

type Loaded = { status: "ok"; doc: LegalText } | { status: "missing" } | { status: "unavailable" };

async function load(kind: string, version: string): Promise<Loaded> {
  if (!KINDS.includes(kind as Kind) || !VERSION_RE.test(version)) return { status: "missing" };
  try {
    // Таймаут (docs/06 §6.8): API не ответил за 10 с — «Документ временно недоступен», а не зависшая страница.
    const api = createClient<paths>({ baseUrl: API_BASE_URL, fetch: (r) => fetch(r, { cache: "no-store", signal: AbortSignal.timeout(10_000) }) });
    const { data, response } = await api.GET("/api/v1/legal-documents/{kind}/{version}", { params: { path: { kind: kind as Kind, version } } });
    if (data) return { status: "ok", doc: data };
    return response.status === 404 ? { status: "missing" } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Название платформы на башкирском — с разметкой языка (правило 6: бренд уже в docs/native-review-queue.md). */
function withBrand(text: string): ReactNode {
  const parts = text.split(BRAND);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 ? <span lang="ba">{BRAND}</span> : null}
    </Fragment>
  ));
}

type Params = { params: Promise<{ kind: string; version: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { kind, version } = await params;
  const loaded = await load(kind, version);
  return { title: loaded.status === "ok" ? loaded.doc.title : "Документ" };
}

/** Страница юридического документа: `LegalDocument.url` = `${PUBLIC_WEB_URL}/legal/<вид>/<версия>`. */
export default async function LegalDocumentPage({ params }: Params) {
  const { kind, version } = await params;
  const loaded = await load(kind, version);
  if (loaded.status === "missing") notFound();

  return (
    <Screen top={<SimpleTop back="/" title="Документы" />}>
      {loaded.status === "unavailable" ? (
        <EmptyState
          art="emptyError"
          title="Документ временно недоступен"
          role="alert"
          actions={
            <>
              <ButtonLink href={`/legal/${kind}/${version}`} block>
                Попробовать снова
              </ButtonLink>
              <ButtonLink href="/" variant="secondary" block>
                На главную
              </ButtonLink>
            </>
          }
        >
          Не удалось загрузить текст. Попробуйте ещё раз через минуту.
        </EmptyState>
      ) : (
        <Card roomy>
          <article className="tt-stack legal">
            <header className="tt-stack tt-stack--tight">
              <h1 className="tt-title2">{loaded.doc.title}</h1>
              <p className="tt-muted">
                Редакция {loaded.doc.version}, действует с {dateFmt.format(new Date(loaded.doc.effectiveFrom))}
              </p>
            </header>
            {loaded.doc.body.map((paragraph, i) => (
              <p key={i}>{withBrand(paragraph)}</p>
            ))}
          </article>
        </Card>
      )}
    </Screen>
  );
}
