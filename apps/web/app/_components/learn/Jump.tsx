"use client";

// Испытание для перехода (docs/02 §2): знающий открывает закрытое место, не проходя уроки перед
// ним. Здесь — предложение у вывески закрытого места (GET /course → unit.jump) и итог испытания (summary.jump).
// Правила (сколько заданий и ошибок) решает сервер и на экране их нет.
import { useEffect } from "react";
import { Drop, Lightning } from "@phosphor-icons/react/ssr";
import { Button, StatTile, StatTiles, useCountUp } from "@teletau/ui";
import { useT } from "../../../i18n/client";
import { AfterScreen } from "./AfterLesson";
import type { Course, CourseUnit, LessonSummary } from "./model";
import { placeArt } from "./places";
import { playSound } from "./sound";
import "./jump.css";

/** «Уже знаешь? — Пройти испытание» под вывеской закрытого места. */
export function JumpOffer({ unit, onJump, busy }: { unit: CourseUnit; onJump: (unit: CourseUnit) => void; busy?: boolean }) {
  const t = useT();
  const id = `jump-${unit.id}`;
  return (
    <div className="jump-offer" role="group" aria-labelledby={id}>
      <p className="jump-offer__text" id={id}>
        {t("Уже знаешь?")}
      </p>
      <Button
        small
        variant="secondary"
        icon={<Lightning weight="fill" aria-hidden />}
        loading={busy}
        onClick={() => onJump(unit)}
        aria-label={t("Пройти испытание и открыть место «{place}»", { place: unit.place.titleRu })}
      >
        {t("Пройти испытание")}
      </Button>
    </div>
  );
}

/**
 * Итог испытания: сдано — «Место открыто» (картинка места, мёд); не сдано — «Пока рано», без счёта ошибок: ничего не
 * потеряно, уроки на месте.
 */
export function JumpResultScreen({ course, summary, onContinue }: { course: Course | undefined; summary: LessonSummary; onContinue: () => void }) {
  const t = useT();
  const jump = summary.jump;
  const unit = course?.units.find((u) => u.id === jump?.unitId);
  const passed = jump?.passed ?? false;
  const honey = useCountUp(passed ? summary.honey.total : 0);
  useEffect(() => {
    if (passed) playSound("complete");
  }, [passed]);
  if (!passed) {
    return (
      <AfterScreen art="beeSympathy" artAlt="" action={t("К урокам")} onAction={onContinue}>
        <h1 className="after__title" tabIndex={-1}>
          {t("Пока рано")}
        </h1>
      </AfterScreen>
    );
  }
  const art = unit ? placeArt(unit.place.slug) : undefined;
  return (
    <AfterScreen art={art?.hero ?? "beeCheer"} artAlt={art?.heroAlt ? t(art.heroAlt) : ""} wide={Boolean(art?.hero)} artMotion={art?.hero ? undefined : "hop"} confetti action={t("Дальше")} onAction={onContinue}>
      <h1 className="after__title" tabIndex={-1}>
        {t("Место открыто")}
      </h1>
      {unit ? (
        <p className="after__lead jump-result__place">
          {unit.place.titleBa ? (
            <>
              <span lang="ba">{unit.place.titleBa.text}</span> · {unit.place.titleRu}
            </>
          ) : (
            unit.place.titleRu
          )}
        </p>
      ) : null}
      <div className="jump-result__honey">
        <StatTiles label={t("Итог испытания")}>
          <StatTile label={t("Мёд")} icon={<Drop weight="fill" />} value={`+${honey}`} />
        </StatTiles>
      </div>
    </AfterScreen>
  );
}
