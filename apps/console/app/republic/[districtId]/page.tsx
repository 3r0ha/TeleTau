"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Buildings, ChartBar, Exam, Student } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { ButtonLink, Chip, EmptyState, Skeleton, SkeletonGroup } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { ApiProblem } from "@teletau/session/problem";
import { ConsoleShell } from "../../_components/ConsoleShell";
import { LoadFailure } from "../../_components/LoadFailure";
import { plural } from "../../_components/plural";
import { ActivityCell, asOfLabel, GroupNumber, Kpi, Kpis, num, SmallGroupThresholdProvider, SortHeader, SuppressionLegend, useSorted, weekLabel, WeeksChart, type Column } from "../parts";

type Detail = Schema<"RepublicDistrictDetail">;
type SchoolRow = Schema<"RepublicSchoolRow">;

export default function DistrictPage() {
  return <ConsoleShell section="republic">{() => <District />}</ConsoleShell>;
}

function BackLink() {
  return (
    <Link className="back-link" href="/republic">
      <ArrowLeft weight="bold" aria-hidden />
      Республика
    </Link>
  );
}

/** Школы района (ADR 0023): та же таблица, что у районов, и динамика района; малые группы скрыты. */
function District() {
  const { districtId } = useParams<{ districtId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    unwrap(api.GET("/api/v1/ministry/districts/{districtId}", { params: { path: { districtId } } }))
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [districtId, tick]);

  if (error && !data) {
    const missing = error instanceof ApiProblem && (error.status === 404 || error.status === 422);
    return (
      <div className="tt-stack tt-stack--loose">
        <BackLink />
        {missing ? (
          <EmptyState
            art="beeThink"
            compact
            title="Такого района нет"
            role="alert"
            actions={
              <ButtonLink href="/republic" block>
                К списку районов
              </ButtonLink>
            }
          />
        ) : (
          <LoadFailure error={error} onRetry={() => setTick((n) => n + 1)} />
        )}
      </div>
    );
  }
  if (!data) {
    return (
      <SkeletonGroup label="Загружаем район" className="tt-stack tt-stack--loose">
        <Skeleton width="20%" height={20} />
        <Skeleton width="45%" height={32} />
        <div className="kpis-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={104} radius="panel" />
          ))}
        </div>
        <Skeleton height={320} radius="panel" />
      </SkeletonGroup>
    );
  }
  const d = data.district;
  const a = d.activity;
  return (
    <SmallGroupThresholdProvider value={data.smallGroupThreshold}>
      <div className="tt-stack tt-stack--loose republic">
        <BackLink />
        <header className="console__head">
          <div className="tt-stack tt-stack--tight">
            <h1 className="tt-title2">
              {d.nameRu}
              {d.isDemo ? (
                <>
                  {" "}
                  <Chip tone="neutral">демо</Chip>
                </>
              ) : null}
            </h1>
            <p className="tt-muted">
              {d.kind === "urban_okrug" ? "Городской округ" : "Муниципальный район"} · неделя {weekLabel(data.week)} · данные на {asOfLabel(data.asOf)} по Уфе
            </p>
          </div>
        </header>

        <Kpis label="Район в цифрах">
          <Kpi icon={<Buildings weight="fill" />} label="Школ подключено" value={num(d.schools.connected)} note={`из ${num(d.schools.total)} · ${num(d.classes)} ${plural(d.classes, "класс", "класса", "классов")}`} />
          <Kpi icon={<Student weight="fill" />} label="Учеников" value={<GroupNumber value={a.students} suppression={a.suppression} />} />
          <Kpi
            icon={<ChartBar weight="fill" />}
            label="Занимались на этой неделе"
            value={<GroupNumber value={a.activeWeek} suppression={a.suppression} />}
            note={!a.suppression && a.students ? `${Math.round(((a.activeWeek ?? 0) / a.students) * 100)} % учеников` : undefined}
          />
          <Kpi icon={<Exam weight="fill" />} label="Уроков за неделю" value={<GroupNumber value={a.lessonsWeek} suppression={a.suppression} />} note={!a.suppression ? `всего ${num(a.lessonsTotal ?? 0)}` : undefined} />
        </Kpis>

        {a.suppression ? (
          <EmptyState art="beeThink" headingAs="h2" compact title={a.suppression === "small_group" ? `В районе меньше ${data.smallGroupThreshold} учеников` : "Числа района скрыты"}>
            {a.suppression === "small_group" ? "Числа по школам скрыты." : "Иначе малый район вычислят из итога республики."}
          </EmptyState>
        ) : (
          <>
            {data.weeks.length ? <WeeksChart weeks={data.weeks} title="По неделям" /> : null}
            <SchoolsTable detail={data} />
          </>
        )}
      </div>
    </SmallGroupThresholdProvider>
  );
}

const COLUMNS: Column<SchoolRow>[] = [
  { key: "name", label: "Школа", sort: (r) => r.shortNameRu },
  { key: "classes", label: "Классов", sort: (r) => r.classes, numeric: true },
  { key: "students", label: "Учеников", sort: (r) => (r.activity.suppression ? null : (r.activity.students ?? 0)), numeric: true },
  { key: "activeWeek", label: "Занимались на неделе", sort: (r) => (r.activity.suppression ? null : (r.activity.activeWeek ?? 0)), numeric: true },
  { key: "lessonsWeek", label: "Уроков за неделю", sort: (r) => (r.activity.suppression ? null : (r.activity.lessonsWeek ?? 0)), numeric: true },
  { key: "lessonsTotal", label: "Уроков всего", sort: (r) => (r.activity.suppression ? null : (r.activity.lessonsTotal ?? 0)), numeric: true },
];

function SchoolsTable({ detail }: { detail: Detail }) {
  const { sorted, order, toggle } = useSorted(detail.items, COLUMNS, { key: "students", dir: "desc" });
  const kinds = new Set(detail.items.map((r) => r.activity.suppression).filter((k): k is NonNullable<typeof k> => Boolean(k)));
  return (
    <section className="tt-stack" aria-labelledby="schools-title">
      <h2 className="tt-title3" id="schools-title">
        Школы
      </h2>
      <div className="table-wrap">
        <table className="table">
          <caption className="tt-visually-hidden">Школы района: классы, ученики и уроки</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <SortHeader key={c.key} column={c} order={order} onSort={toggle} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((x) => (
              <tr key={x.schoolId}>
                <td>
                  {x.shortNameRu}
                  {x.isDemo ? (
                    <>
                      {" "}
                      <Chip tone="neutral">демо</Chip>
                    </>
                  ) : null}
                </td>
                <td className="table__num" data-label="Классов">
                  {num(x.classes)}
                </td>
                <td className="table__num" data-label="Учеников">
                  <ActivityCell activity={x.activity} k="students" />
                </td>
                <td className="table__num" data-label="Занимались на неделе">
                  <ActivityCell activity={x.activity} k="activeWeek" />
                </td>
                <td className="table__num" data-label="Уроков за неделю">
                  <ActivityCell activity={x.activity} k="lessonsWeek" />
                </td>
                <td className="table__num" data-label="Уроков всего">
                  <ActivityCell activity={x.activity} k="lessonsTotal" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SuppressionLegend threshold={detail.smallGroupThreshold} kinds={kinds} />
    </section>
  );
}
