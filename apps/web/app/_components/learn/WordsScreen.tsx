"use client";

import Link from "next/link";
import { ArrowsClockwise, CaretLeft } from "@phosphor-icons/react/ssr";
import { Bee, ButtonLink, EmptyState, SpeakButton } from "@teletau/ui";
import { localAudio } from "./audio";
import { useResource } from "@teletau/session/react";
import { LoadError, LoadingBlock } from "../screens";
import { learnApi } from "./api";
import { plural } from "./format";
import { useT } from "../../../i18n/client";
import type { MyWord, MyWords } from "./model";
import { useStudentPaths } from "./paths";
import { StudentShell, useStudent } from "./StudentShell";

/**
 * «Мой словарь»: слова из пройденных уроков — башкирское слово (из контента, с флагом проверки носителем),
 * перевод; слова разложены по разделам «На повторение» и «Выучено» (без меток в каждой строке). Запись носителя — кнопка
 * «Послушать». Вход — из профиля.
 */
export function WordsScreen() {
  const account = useStudent();
  const t = useT();
  const words = useResource(() => learnApi.words(), [account?.id], { enabled: Boolean(account) });
  return (
    <StudentShell tab="words" className="words">
      {words.data ? (
        <WordsView data={words.data} />
      ) : words.error ? (
        <LoadError error={words.error} audience="child" onRetry={words.reload} />
      ) : (
        <LoadingBlock rows={5} label={t("Открываем словарь")} />
      )}
    </StudentShell>
  );
}

function WordsView({ data }: { data: MyWords }) {
  const paths = useStudentPaths();
  const t = useT();
  const { total, review } = data.summary;
  const toReview = data.words.filter((w) => w.status === "review");
  const learned = data.words.filter((w) => w.status === "learned");
  return (
    <>
      <header className="words__head">
        <Link href={paths.me} className="words__back">
          <CaretLeft weight="bold" aria-hidden />
          {t("Профиль")}
        </Link>
        <h1 className="page-title">{t("Мой словарь")}</h1>
        {total ? (
          <p className="page-lead">
            {total} {plural(total, [t("слово"), t("слова"), t("слов")])}
            {review ? null : ` · ${t("все выучены")}`}
          </p>
        ) : null}
      </header>

      {total === 0 ? (
        <EmptyState
          art="emptyAllDone"
          title={t("Слов пока нет")}
          headingAs="h2"
          actions={
            <ButtonLink block href={paths.learn}>
              {t("На тропу")}
            </ButtonLink>
          }
        >
          {t("Они появятся после урока.")}
        </EmptyState>
      ) : null}

      {review ? (
        <section className="review-card words__review" aria-labelledby="words-review-title">
          <div className="review-card__row">
            <Bee frame="beeRead" width={60} className="review-card__bee" />
            <div>
              <h2 className="review-card__title" id="words-review-title">
                {t("Повторить {n} {word}", { n: review, word: plural(review, [t("слово"), t("слова"), t("слов")]) })}
              </h2>
            </div>
          </div>
          <ButtonLink block href={paths.review} icon={<ArrowsClockwise weight="bold" aria-hidden />}>
            {t("Начать")}
          </ButtonLink>
        </section>
      ) : null}

      {toReview.length ? <WordList title={t("На повторение")} kind="review" words={toReview} /> : null}
      {learned.length ? <WordList title={t("Выучено")} kind="learned" words={learned} /> : null}
    </>
  );
}

function WordList({ title, kind, words }: { title: string; kind: "review" | "learned"; words: MyWord[] }) {
  const t = useT();
  const id = `words-${kind}`;
  return (
    <section className="word-list" aria-labelledby={id}>
      <h2 className="word-list__title" id={id}>
        {title}
      </h2>
      <ul className="word-list__items">
        {words.map((w) => (
          <li key={w.id} className="word-row">
            <div className="word-row__text">
              <b lang="ba">{w.word.text}</b>
              <span>{w.translationRu}</span>
            </div>
            <SpeakButton sources={localAudio(w.word.audio)} size="small" label={t("Послушать: {word}", { word: w.word.text })} />
          </li>
        ))}
      </ul>
    </section>
  );
}
