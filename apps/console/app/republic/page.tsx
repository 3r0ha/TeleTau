"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Buildings, ChalkboardTeacher, ChartBar, Exam, GraduationCap, HandHeart, MapPin, Student, Translate, Users } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Chip, EmptyState, Skeleton, SkeletonGroup } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem, isNetworkError } from "@teletau/session/problem";
import { ConsoleShell } from "../_components/ConsoleShell";
import { ActivityCell, asOfLabel, GroupNumber, Kpi, Kpis, num, SortHeader, SuppressionLegend, useSorted, weekLabel, WeeksChart, type Column } from "./parts";

type Summary = Schema<"RepublicSummary">;
type DistrictList = Schema<"RepublicDistrictList">;
type DistrictRow = Schema<"RepublicDistrictRow">;

export default function RepublicPage() {
  return <ConsoleShell section="republic">{() => <Republic />}</ConsoleShell>;
}

/** «Республика» (ADR 0023): сводка, динамика по неделям и таблица районов — только агрегаты, малые группы скрыты. */
function Republic() {
  const [data, setData] = useState<{ summary: Summary; districts: DistrictList } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([unwrap(api.GET("/api/v1/ministry/summary")), unwrap(api.GET("/api/v1/ministry/districts"))])
      .then(([summary, districts]) => !cancelled && setData({ summary, districts }))
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (error && !data) {
    return (
      <EmptyState
        art={isNetworkError(error) ? "emptyOffline" : "emptyError"}
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
    );
  }
  if (!data) {
    return (
      <SkeletonGroup label="Загружаем сводку по республике" className="tt-stack tt-stack--loose">
        <Skeleton width="40%" height={32} />
        <div className="kpis-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={104} radius="panel" />
          ))}
        </div>
        <Skeleton height={260} radius="panel" />
        <Skeleton height={320} radius="panel" />
      </SkeletonGroup>
    );
  }
  const { summary: s, districts } = data;
  return (
    <div className="tt-stack tt-stack--loose republic">
      <header className="console__head">
        <div className="tt-stack tt-stack--tight">
          <h1 className="tt-title2">Республика Башкортостан</h1>
          <p className="tt-muted">
            Неделя {weekLabel(s.week)} · данные на {asOfLabel(s.asOf)} по Уфе
          </p>
        </div>
      </header>

      <section className="tt-stack" aria-labelledby="kpi-reach">
        <h2 className="section-title" id="kpi-reach">
          Охват
        </h2>
        <Kpis label="Охват">
          <Kpi icon={<MapPin weight="fill" />} label="Районов и округов подключено" value={num(s.districts.connected)} note={`из ${num(s.districts.total)}`} />
          <Kpi icon={<Buildings weight="fill" />} label="Школ подключено" value={num(s.schools.connected)} note={`из ${num(s.schools.total)}`} />
          <Kpi icon={<Users weight="fill" />} label="Классов" value={num(s.classes)} />
          <Kpi icon={<ChalkboardTeacher weight="fill" />} label="Учителей подтверждено" value={num(s.teachersVerified)} />
        </Kpis>
      </section>

      <section className="tt-stack" aria-labelledby="kpi-learners">
        <h2 className="section-title" id="kpi-learners">
          Ученики
        </h2>
        <Kpis label="Ученики">
          <Kpi icon={<Student weight="fill" />} label="Учеников в школах" value={<GroupNumber {...s.students.school} />} />
          <Kpi icon={<GraduationCap weight="fill" />} label="Учатся сами" value={<GroupNumber {...s.students.self} />} />
          <Kpi
            icon={<ChartBar weight="fill" />}
            label="Занимались на этой неделе"
            value={<GroupNumber value={s.learners.activeWeek} suppression={s.learners.suppression} />}
            note={!s.learners.suppression && s.learners.students ? `${Math.round(((s.learners.activeWeek ?? 0) / s.learners.students) * 100)} % учеников` : undefined}
          />
          <Kpi icon={<Exam weight="fill" />} label="Уроков за неделю" value={<GroupNumber value={s.learners.lessonsWeek} suppression={s.learners.suppression} />} note={!s.learners.suppression ? `всего ${num(s.learners.lessonsTotal ?? 0)}` : undefined} />
        </Kpis>
      </section>

      <section className="tt-stack" aria-labelledby="kpi-language">
        <h2 className="section-title" id="kpi-language">
          Учёба и помощь языку
        </h2>
        <Kpis label="Учёба и помощь языку">
          <Kpi icon={<BookOpen weight="fill" />} label="Слов выучено" value={s.wordsLearned !== undefined ? num(s.wordsLearned) : <GroupNumber suppression="small_group" />} />
          <Kpi icon={<HandHeart weight="fill" />} label="Голосов в «Помоги языку»" value={num(s.votes)} />
          <Kpi icon={<Translate weight="fill" />} label="Пар принято в словарь" value={num(s.pairsAccepted)} note="предварительно" />
        </Kpis>
      </section>

      {s.weeks.length ? <WeeksChart weeks={s.weeks} title="По неделям" /> : null}

      <DistrictsTable list={districts} />
    </div>
  );
}

const COLUMNS: Column<DistrictRow>[] = [
  { key: "name", label: "Район или округ", sort: (r) => r.nameRu },
  { key: "schools", label: "Школ", sort: (r) => r.schools.connected, numeric: true },
  { key: "classes", label: "Классов", sort: (r) => r.classes, numeric: true },
  { key: "students", label: "Учеников", sort: (r) => (r.activity.suppression ? null : (r.activity.students ?? 0)), numeric: true },
  { key: "activeWeek", label: "Занимались на неделе", sort: (r) => (r.activity.suppression ? null : (r.activity.activeWeek ?? 0)), numeric: true },
  { key: "lessonsWeek", label: "Уроков за неделю", sort: (r) => (r.activity.suppression ? null : (r.activity.lessonsWeek ?? 0)), numeric: true },
  { key: "lessonsTotal", label: "Уроков всего", sort: (r) => (r.activity.suppression ? null : (r.activity.lessonsTotal ?? 0)), numeric: true },
];

/** Районы: по умолчанию — подключённые, по числу учеников; «Все районы» — и неподключённые, с нулями. */
function DistrictsTable({ list }: { list: DistrictList }) {
  const [all, setAll] = useState(false);
  const connected = useMemo(() => list.items.filter((d) => d.schools.connected > 0), [list.items]);
  const rows = all ? list.items : connected;
  const { sorted, order, toggle } = useSorted(rows, COLUMNS, { key: "students", dir: "desc" });
  const kinds = new Set([...rows.map((r) => r.activity.suppression), list.selfLearners.suppression].filter((k): k is NonNullable<typeof k> => Boolean(k)));

  return (
    <section className="tt-stack" aria-labelledby="districts-title">
      <header className="console__head">
        <div className="tt-stack tt-stack--tight">
          <h2 className="tt-title3" id="districts-title">
            Районы и городские округа
          </h2>
          <p className="tt-muted">
            Подключено {num(connected.length)} из {num(list.items.length)}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Какие районы показать">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
            Подключённые
          </button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
            Все районы
          </button>
        </div>
      </header>
      {rows.length === 0 ? (
        <EmptyState art="emptyAllDone" headingAs="h3" compact title="Подключённых районов нет">
          Район появится после первого класса в его школе.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="tt-visually-hidden">Районы и городские округа: школы, классы, ученики и уроки</caption>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <SortHeader key={c.key} column={c} order={order} onSort={toggle} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.districtId}>
                  <td>
                    {d.schools.connected > 0 ? (
                      <Link className="table__link" href={`/republic/${d.districtId}`}>
                        {d.nameRu}
                      </Link>
                    ) : (
                      d.nameRu
                    )}
                    {d.isDemo ? (
                      <>
                        {" "}
                        <Chip tone="violet">демо</Chip>
                      </>
                    ) : null}
                    <span className="table__sub">{d.kind === "urban_okrug" ? "городской округ" : "муниципальный район"}</span>
                  </td>
                  <td className="table__num" data-label="Школ">
                    <span>
                      {num(d.schools.connected)}
                      <span className="table__sub">из {num(d.schools.total)}</span>
                    </span>
                  </td>
                  <td className="table__num" data-label="Классов">
                    {num(d.classes)}
                  </td>
                  <td className="table__num" data-label="Учеников">
                    <ActivityCell activity={d.activity} k="students" />
                  </td>
                  <td className="table__num" data-label="Занимались на неделе">
                    <ActivityCell activity={d.activity} k="activeWeek" />
                  </td>
                  <td className="table__num" data-label="Уроков за неделю">
                    <ActivityCell activity={d.activity} k="lessonsWeek" />
                  </td>
                  <td className="table__num" data-label="Уроков всего">
                    <ActivityCell activity={d.activity} k="lessonsTotal" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  Учатся сами
                  <span className="table__sub">без школы и класса</span>
                </th>
                <td className="table__num" data-label="Школ">
                  —
                </td>
                <td className="table__num" data-label="Классов">
                  —
                </td>
                <td className="table__num" data-label="Учеников">
                  <ActivityCell activity={list.selfLearners} k="students" />
                </td>
                <td className="table__num" data-label="Занимались на неделе">
                  <ActivityCell activity={list.selfLearners} k="activeWeek" />
                </td>
                <td className="table__num" data-label="Уроков за неделю">
                  <ActivityCell activity={list.selfLearners} k="lessonsWeek" />
                </td>
                <td className="table__num" data-label="Уроков всего">
                  <ActivityCell activity={list.selfLearners} k="lessonsTotal" />
                </td>
              </tr>
              <tr className="table__total">
                <th scope="row">Итого</th>
                <td className="table__num" data-label="Школ">
                  {num(list.items.reduce((n, d) => n + d.schools.connected, 0))}
                </td>
                <td className="table__num" data-label="Классов">
                  {num(list.items.reduce((n, d) => n + d.classes, 0))}
                </td>
                <td className="table__num" data-label="Учеников">
                  <ActivityCell activity={list.total} k="students" />
                </td>
                <td className="table__num" data-label="Занимались на неделе">
                  <ActivityCell activity={list.total} k="activeWeek" />
                </td>
                <td className="table__num" data-label="Уроков за неделю">
                  <ActivityCell activity={list.total} k="lessonsWeek" />
                </td>
                <td className="table__num" data-label="Уроков всего">
                  <ActivityCell activity={list.total} k="lessonsTotal" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <SuppressionLegend threshold={list.smallGroupThreshold} kinds={kinds} />
    </section>
  );
}
