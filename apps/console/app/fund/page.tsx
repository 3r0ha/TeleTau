"use client";

import { useEffect, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Chip, EmptyState, InlineAlert, Skeleton, SkeletonGroup } from "@teletau/ui";
import { saveTextFile } from "@teletau/ui/files";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem, isNetworkError } from "@teletau/session/problem";
import { ConsoleShell } from "../_components/ConsoleShell";
import { decisionDate, dictionaryCsv, dictionaryJson, escalatedCsv, escalatedJson, exportFileName, kindLabel, originLabel } from "./export";

type Dictionary = Schema<"FundDictionary">;
type Pair = Schema<"FundPair">;
type Escalated = Schema<"FundEscalated">;
type EscRow = Schema<"EscalatedItem">;
type Votes = Schema<"FundGroupVotes">;

const nf = new Intl.NumberFormat("ru-RU");

export default function FundPage() {
  return (
    <ConsoleShell section="fund">
      {() => (
        <div className="tt-stack tt-stack--loose">
          <FundDictionary />
          <FundEscalated />
        </div>
      )}
    </ConsoleShell>
  );
}

/** «Словарь для Фонда» (ADR 0023): принятые пары с голосами по группам; скачать — CSV для Excel или JSON. */
function FundDictionary() {
  const [data, setData] = useState<Dictionary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    unwrap(api.GET("/api/v1/fund/dictionary"))
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const preliminary = data?.items.some((p) => p.preliminary) ?? false;
  // Все пары предварительные — хватит плашки сверху, метка в каждой строке не нужна.
  const allPreliminary = data?.items.every((p) => p.preliminary) ?? false;
  const sources = new Set(data?.items.map((p) => p.itemId));

  return (
    <section className="tt-stack tt-stack--loose" aria-labelledby="fund-dictionary">
      <header className="console__head">
        <div className="tt-stack tt-stack--tight">
          <h1 id="fund-dictionary" className="tt-title2">
            Словарь для Фонда
          </h1>
          <p className="tt-muted">Пары, принятые голосованием в «Помоги языку».</p>
        </div>
        {data && data.items.length > 0 ? (
          <div className="table__actions">
            <Button small icon={<DownloadSimple weight="bold" />} onClick={() => saveTextFile(exportFileName(data, "dictionary", "csv"), dictionaryCsv(data))}>
              Скачать таблицу (CSV)
            </Button>
            <Button small variant="secondary" icon={<DownloadSimple weight="bold" />} onClick={() => saveTextFile(exportFileName(data, "dictionary", "json"), dictionaryJson(data), "application/json;charset=utf-8")}>
              Скачать данные (JSON)
            </Button>
          </div>
        ) : null}
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
        <SkeletonGroup label="Загружаем словарь" className="tt-stack tt-stack--tight">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} radius="tile" />
          ))}
        </SkeletonGroup>
      ) : data.items.length === 0 ? (
        <EmptyState art="emptyAllDone" headingAs="h2" compact title="Принятых пар пока нет" />
      ) : (
        <>
          {preliminary ? (
            <InlineAlert tone="info">
              <b>Предварительно.</b> Пары приняты по упрощённым правилам и могут уточниться.
            </InlineAlert>
          ) : null}
          <p className="tt-muted">
            {nf.format(data.items.length)} {pluralPairs(data.items.length)} · {nf.format(sources.size)} {sourcesWord(sources.size)}
          </p>
          <div className="table-wrap">
            <table className="table">
              <caption className="tt-visually-hidden">Принятые пары: исходник, вариант, голоса по группам, решение и источник</caption>
              <thead>
                <tr>
                  <th scope="col">Русский</th>
                  <th scope="col">Башкирский</th>
                  <th scope="col">Голоса</th>
                  <th scope="col">Решение</th>
                  <th scope="col" className="table__source">
                    Источник
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <PairRow key={`${p.itemId}:${p.variantId}`} pair={p} markPreliminary={!allPreliminary} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function sourcesWord(n: number): string {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? "исходник" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "исходника" : "исходников";
}

/**
 * «Спорные случаи» (ТЗ хакатона §4.4/§5): пары, в которых голоса групп разошлись и упрощённые правила не выбрали
 * вариант. Загружаются отдельно от словаря; выгрузка — теми же CSV/JSON для передачи экспертам.
 */
function FundEscalated() {
  const [data, setData] = useState<Escalated | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    unwrap(api.GET("/api/v1/fund/escalated"))
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const items = data?.items ?? [];

  return (
    <section className="tt-stack tt-stack--tight" aria-labelledby="fund-escalated">
      <header className="console__head">
        <div className="tt-stack tt-stack--tight">
          <h2 id="fund-escalated" className="tt-title2">
            Спорные случаи
          </h2>
          <p className="tt-muted">Голоса групп разошлись — пары передаются экспертам.</p>
        </div>
        {data && items.length > 0 ? (
          <div className="table__actions">
            <Button small icon={<DownloadSimple weight="bold" />} onClick={() => saveTextFile(exportFileName(data, "escalated", "csv"), escalatedCsv(data))}>
              Скачать таблицу (CSV)
            </Button>
            <Button small variant="secondary" icon={<DownloadSimple weight="bold" />} onClick={() => saveTextFile(exportFileName(data, "escalated", "json"), escalatedJson(data), "application/json;charset=utf-8")}>
              Скачать данные (JSON)
            </Button>
          </div>
        ) : null}
      </header>

      {error && !data ? (
        <EmptyState
          art={isNetworkError(error) ? "emptyOffline" : "emptyError"}
          headingAs="h3"
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
        <SkeletonGroup label="Загружаем спорные случаи" className="tt-stack tt-stack--tight">
          {[0, 1].map((i) => (
            <Skeleton key={i} height={64} radius="tile" />
          ))}
        </SkeletonGroup>
      ) : items.length === 0 ? (
        <EmptyState art="emptyAllDone" headingAs="h3" compact title="Спорных случаев нет">
          Голоса групп сходятся — пары принимает голосование.
        </EmptyState>
      ) : (
        <>
          <p className="tt-muted">
            {nf.format(items.length)} {pluralDisputes(items.length)}
          </p>
          <div className="table-wrap">
            <table className="table">
              <caption className="tt-visually-hidden">Спорные случаи: исходник, два варианта и голоса групп по каждому</caption>
              <thead>
                <tr>
                  <th scope="col">Русский</th>
                  <th scope="col">Варианты и голоса</th>
                  <th scope="col">Последний голос</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <EscRowView key={item.itemId} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function pluralDisputes(n: number): string {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? "спор" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "спора" : "споров";
}

function EscRowView({ item }: { item: EscRow }) {
  return (
    <tr>
      <td>
        <b>{item.sourceRu}</b>
        <span className="table__sub">{kindLabel(item.kind)}</span>
      </td>
      <td data-label="Варианты и голоса">
        <ul className="duel-variants">
          {item.variants.map((v, i) => (
            <li key={v.variantId}>
              <span lang="ba" className="pair__ba">
                {v.text}
              </span>
              <span className="pair__chips">
                <Chip tone="neutral">{i === 0 ? "вариант 1" : "вариант 2"}</Chip>
                {v.review === "native_approved" ? <Chip tone="green">проверено носителем</Chip> : null}
              </span>
              <ul className="votes">
                <GroupVotes label="Дети" v={v.votes.child} />
                <GroupVotes label="Взрослые" v={v.votes.adult} />
                <GroupVotes label="Учителя" v={v.votes.teacher} />
              </ul>
            </li>
          ))}
        </ul>
      </td>
      <td className="table__nowrap" data-label="Последний голос">
        {decisionDate(item.lastVoteAt)}
      </td>
    </tr>
  );
}

function pluralPairs(n: number): string {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? "пара" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "пары" : "пар";
}

function GroupVotes({ label, v }: { label: string; v: Votes }) {
  return (
    <li>
      <span className="votes__group">{label}</span>{" "}
      <b>
        {nf.format(v.votesFor)} из {nf.format(v.total)}
      </b>
      {v.both ? <span className="votes__both">«оба подходят» {nf.format(v.both)}</span> : null}
    </li>
  );
}

function PairRow({ pair: p, markPreliminary }: { pair: Pair; markPreliminary: boolean }) {
  const src = p.sources[0];
  return (
    <tr>
      <td>
        <b>{p.sourceRu}</b>
        <span className="table__sub">{kindLabel(p.kind)}</span>
      </td>
      <td>
        <span lang="ba" className="pair__ba">
          {p.textBa}
        </span>
        <span className="pair__chips">
          {p.main ? null : <Chip tone="neutral">второй вариант</Chip>}
          {p.review === "native_approved" ? <Chip tone="green">проверено носителем</Chip> : <Chip tone="water">ждёт проверки носителем</Chip>}
          {p.tags.includes("children_prefer") ? <Chip tone="violet">так говорят дети</Chip> : null}
        </span>
      </td>
      <td data-label="Голоса">
        <ul className="votes">
          <GroupVotes label="Дети" v={p.votes.child} />
          <GroupVotes label="Взрослые" v={p.votes.adult} />
          <GroupVotes label="Учителя" v={p.votes.teacher} />
        </ul>
      </td>
      <td className="table__nowrap" data-label="Решение">
        {decisionDate(p.decidedAt)}
        <span className="table__sub">{p.decidedBy === "expert" ? "эксперт" : "голосование"}</span>
        {p.preliminary && markPreliminary ? (
          <span className="pair__chips">
            <Chip tone="honey">предварительно</Chip>
          </span>
        ) : null}
      </td>
      <td className="table__source" data-label="Источник">
        {src ? (
          <>
            {src.url ? (
              <a className="table__link" href={src.url} target="_blank" rel="noreferrer noopener">
                {src.title}
              </a>
            ) : (
              src.title
            )}
            {src.locator ? <span className="table__sub">{src.locator}</span> : null}
            <span className="table__sub">
              {originLabel(p.origin)}
              {src.license ? ` · ${src.license}` : ""}
            </span>
          </>
        ) : (
          <span className="table__sub">{originLabel(p.origin)}</span>
        )}
      </td>
    </tr>
  );
}
