"use client";

import { ButtonLink, Card, CardSub, CardTitle, Chip, EmptyState, HoneyComb, Illustration, ProgressBar } from "@teletau/ui";
import { Check } from "@phosphor-icons/react/ssr";
import { useResource } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import { ClassTitle, LoadError, LoadingBlock } from "../screens";
import { learnApi } from "./api";
import { plural, weekdayShort } from "./format";
import type { ClassHive } from "./model";
import { useStudentPaths } from "./paths";
import { StudentShell, studentClass, useStudent } from "./StudentShell";

const COMB = 12;

/**
 * Вкладка «Класс» (prototype 17-class): улей класса (сцена — борть с пчёлами) — квест недели в сотах и сколько ребят
 * занимались. Только агрегаты:
 * никаких рейтингов отдельных детей (docs/05 §8, п. 5). Индекса улья и рейтинга школы здесь нет.
 */
export function HiveScreen() {
  const t = useT();
  const account = useStudent();
  const paths = useStudentPaths();
  const klass = studentClass(account);
  const hive = useResource(() => learnApi.hive(klass!.id), [klass?.id], { enabled: Boolean(klass) });
  return (
    <StudentShell tab="hive" className="hive" rail={{ hive: hive.data }}>
      {account && !klass ? (
        account.kind === "child" ? (
          // «Учусь сам» (ADR 0022): класс — по желанию, по коду с доски и с одобрением учителя.
          <EmptyState
            art="sceneClassHive"
            title={t("Класса пока нет")}
            actions={
              <ButtonLink href={paths.joinClass} block>
                {t("Вступить в класс")}
              </ButtonLink>
            }
          >
            {t("Попроси у учителя код класса.")}
          </EmptyState>
        ) : (
          <EmptyState
            art="beeIdle"
            title={t("Класс — для школьников")}
            actions={
              <ButtonLink href={paths.league} variant="secondary" block>
                {t("В лигу")}
              </ButtonLink>
            }
          >
            {t("Соревнуйся в лиге.")}
          </EmptyState>
        )
      ) : hive.data && klass ? (
        <HiveView hive={hive.data} title={klass.title} schoolName={klass.schoolName} />
      ) : hive.error ? (
        <LoadError error={hive.error} onRetry={hive.reload} audience="child" />
      ) : (
        <LoadingBlock rows={2} label={t("Загружаем улей")} />
      )}
    </StudentShell>
  );
}

const BAR_H = 44;

/** Сколько ребят занимались в каждый день недели — столбики-соты без имён (GET /classes/{id}/hive → days). */
function HiveDays({ days }: { days: ClassHive["days"] }) {
  const t = useT();
  const max = Math.max(1, ...days.map((d) => d.active));
  return (
    <ol className="hive-days" aria-label={t("По дням недели")}>
      {days.map((d) => {
        const h = d.active ? Math.max(6, Math.round((d.active / max) * BAR_H)) : 3;
        return (
          <li key={d.date} className="hive-days__day">
            <svg width={22} height={BAR_H} viewBox={`0 0 22 ${BAR_H}`} aria-hidden focusable="false">
              <rect className={d.active ? "hive-days__bar" : "hive-days__bar hive-days__bar--empty"} x={0} y={BAR_H - h} width={22} height={h} rx={5} />
            </svg>
            <span aria-hidden>{t(weekdayShort(d.date))}</span>
            <span className="tt-visually-hidden">
              {t(weekdayShort(d.date))}: {d.active}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function HiveView({ hive, title, schoolName }: { hive: ClassHive; title: string; schoolName: string }) {
  const t = useT();
  const { goal, progress, completed } = hive.quest;
  const filled = goal > 0 ? Math.min(COMB, Math.round((Math.min(progress, goal) / goal) * COMB)) : 0;
  const { active, total } = hive.participation;
  return (
    <>
      <header className="page-head-block hive__head">
        <div>
          <h1 className="page-title">
            {t("Улей")} <ClassTitle title={title} />
          </h1>
          <p className="page-lead">
            {schoolName} · {total} {plural(total, [t("ученик"), t("ученика"), t("учеников")])}
          </p>
        </div>
        <Illustration name="sceneClassHive" width={104} className="hive__art" />
      </header>
      <Card as="section" className="tab-card" aria-labelledby="quest-title">
        <CardTitle id="quest-title">{t("Квест недели")}</CardTitle>
        <CardSub>{t("Пройдите всем классом {n} {lessons}", { n: goal, lessons: plural(goal, [t("урок"), t("урока"), t("уроков")]) })}</CardSub>
        {completed ? (
          <Chip tone="green" icon={<Check weight="bold" aria-hidden />} className="tab-card__chip">
            {t("Квест выполнен")}
          </Chip>
        ) : null}
        <div className="tab-card__comb">
          <HoneyComb total={COMB} filled={filled} />
        </div>
        <ProgressBar value={Math.min(progress, goal)} max={goal} label={t("Квест недели")} valueText={t("{n} из {total}", { n: progress, total: goal })} showValue />
      </Card>
      <Card as="section" className="tab-card" aria-labelledby="active-title">
        <CardTitle id="active-title">{t("На этой неделе")}</CardTitle>
        <CardSub>{t("Занимались {n} из {total}", { n: active, total })}</CardSub>
        <div className="tab-card__comb">
          <HoneyComb total={total} filled={active} perRow={COMB} label={t("Занимались {n} из {total}", { n: active, total })} />
        </div>
        {hive.days.length ? <HiveDays days={hive.days} /> : null}
      </Card>
    </>
  );
}
