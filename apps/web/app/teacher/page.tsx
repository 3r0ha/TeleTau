"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Cards, Check, Plus, ProjectorScreen, UsersThree } from "@phosphor-icons/react/ssr";
import { Button, ButtonLink, Illustration, Skeleton, SkeletonGroup } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { useResource } from "@teletau/session/react";
import type { Me } from "@teletau/session/types";
import { useT } from "../../i18n/client";
import { LoadError } from "../_components/screens";
import { ClassBoardCard } from "./ClassBoard";
import { CreateClassDialog } from "./CreateClassDialog";
import { TeacherShell } from "./TeacherShell";
import { useTeacherGate } from "./useTeacher";

/**
 * Кабинет учителя: мои классы. У каждого класса — кто занимался сегодня, задание, кто не занимался на неделе, заявки на
 * вход (ClassBoard.tsx). Один класс — карточка на всю ширину, несколько — сетка. Ниже — «Помогите языку», если есть пары.
 * Первый вход (классов нет) — три шага к первому уроку, начиная с «Создать класс».
 */
export default function TeacherHomePage() {
  const { me } = useTeacherGate("verified");
  const router = useRouter();
  const t = useT();
  const [creating, setCreating] = useState(false);
  const classes = useResource(() => unwrap(api.GET("/api/v1/classes")), [me?.id], { enabled: Boolean(me) });
  const items = (classes.data?.items ?? []).filter((c) => c.myRole === "teacher");

  return (
    <TeacherShell>
      <div className="tt-stack tt-stack--loose teacher-home">
        <header className="page-head">
          <h1 className="tt-title1">{t("Мои классы")}</h1>
          {items.length ? (
            <Button icon={<Plus weight="bold" />} onClick={() => setCreating(true)}>
              {t("Создать класс")}
            </Button>
          ) : null}
        </header>

        {classes.error && !classes.data ? (
          <LoadError error={classes.error} onRetry={classes.reload} />
        ) : !me || !classes.data ? (
          <SkeletonGroup label={t("Загружаем классы")} className="class-board">
            {[0, 1].map((i) => (
              <Skeleton key={i} height={320} radius="card" />
            ))}
          </SkeletonGroup>
        ) : items.length === 0 ? (
          <FirstClass me={me} onCreate={() => setCreating(true)} />
        ) : (
          <>
            <ul className="class-board" data-solo={items.length === 1 || undefined} aria-label={t("Классы")}>
              {items.map((c) => (
                <li key={c.id}>
                  <ClassBoardCard c={c} solo={items.length === 1} />
                </li>
              ))}
            </ul>
            <DuelsTeaser />
          </>
        )}
      </div>
      <CreateClassDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => router.replace(`/teacher/classes/${id}`)} />
    </TeacherShell>
  );
}

/** «Айгуль Рашитовна» из «Галиева Айгуль Рашитовна»: к учителю — по имени и отчеству; иначе без имени. */
function addressOf(me: Me): string | null {
  const parts = (me.profile?.fullName ?? "").trim().split(/\s+/);
  return parts.length === 3 ? `${parts[1]} ${parts[2]}` : null;
}

/** Первый вход после одобрения: путь из трёх шагов — класс, карточки, код на доске. */
function FirstClass({ me, onCreate }: { me: Me; onCreate: () => void }) {
  const name = addressOf(me);
  const t = useT();
  return (
    <section className="tt-card first-class" aria-labelledby="first-class-title">
      <div className="first-class__main">
        <div className="tt-stack tt-stack--tight">
          <p className="first-class__hello">
            <Check weight="bold" aria-hidden /> {name ? t("{name}, кабинет открыт", { name }) : t("Кабинет открыт")}
          </p>
          <h2 id="first-class-title" className="tt-title1">
            {t("Первый урок")}
          </h2>
        </div>
        <ol className="first-class__steps">
          <li data-current>
            <span className="first-class__icon" aria-hidden>
              <UsersThree weight="fill" />
            </span>
            <b>{t("Создайте класс")}</b>
          </li>
          <li>
            <span className="first-class__icon" aria-hidden>
              <Cards weight="fill" />
            </span>
            <b>{t("Раздайте карточки")}</b>
          </li>
          <li>
            <span className="first-class__icon" aria-hidden>
              <ProjectorScreen weight="fill" />
            </span>
            <b>{t("Покажите код на доске")}</b>
          </li>
        </ol>
        <p className="tt-muted">{t("Уже вели классы в ТелеТау? Проверьте адрес почты, с которым вы вошли.")}</p>
        <div className="first-class__actions">
          <Button icon={<Plus weight="bold" />} onClick={onCreate}>
            {t("Создать класс")}
          </Button>
        </div>
      </div>
      <Illustration name="beeTeacher" width={300} className="first-class__art" />
    </section>
  );
}

/** «Помогите языку» на главной — только когда есть пары, за которые учитель ещё не голосовал. */
function DuelsTeaser() {
  const t = useT();
  const duels = useResource(() => unwrap(api.GET("/api/v1/corpus/duels", { params: { query: { limit: 1 } } })), []);
  if (!duels.data?.items.length) return null;
  return (
    <section className="tt-card duels-teaser" aria-labelledby="duels-teaser-title">
      <Illustration name="sceneDuel" width={112} className="duels-teaser__art" />
      <div className="duels-teaser__text">
        <h2 id="duels-teaser-title" className="tt-title3">
          {t("Помогите языку")}
        </h2>
        <p className="tt-muted">{t("Новые пары переводов ждут вашего голоса.")}</p>
      </div>
      <ButtonLink href="/teacher/duels" variant="violet" className="duels-teaser__go">
        {t("Оценить пары")}
      </ButtonLink>
    </section>
  );
}
