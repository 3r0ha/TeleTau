"use client";

import Link from "next/link";
import { ArrowsClockwise, CaretLeft } from "@phosphor-icons/react/ssr";
import { Bee, ButtonLink, EmptyState, SpeakButton } from "@teletau/ui";
import { localAudio } from "./audio";
import { useResource } from "@teletau/session/react";
import { LoadError, LoadingBlock } from "../screens";
import { learnApi } from "./api";
import { plural } from "./format";
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
  const words = useResource(() => learnApi.words(), [account?.id], { enabled: Boolean(account) });
  return (
    <StudentShell tab="words" className="words">
      {words.data ? (
        <WordsView data={words.data} />
      ) : words.error ? (
        <LoadError error={words.error} audience="child" onRetry={words.reload} />
      ) : (
        <LoadingBlock rows={5} label="Открываем словарь" />
      )}
    </StudentShell>
  );
}

function WordsView({ data }: { data: MyWords }) {
  const paths = useStudentPaths();
  const { total, review } = data.summary;
  const toReview = data.words.filter((w) => w.status === "review");
  const learned = data.words.filter((w) => w.status === "learned");
  return (
    <>
      <header className="words__head">
        <Link href={paths.me} className="words__back">
          <CaretLeft weight="bold" aria-hidden />
          Профиль
        </Link>
        <h1 className="page-title">Мой словарь</h1>
        {total ? (
          <p className="page-lead">
            {total} {plural(total, ["слово", "слова", "слов"])}
            {review ? null : " · все выучены"}
          </p>
        ) : null}
      </header>

      {total === 0 ? (
        <EmptyState
          art="emptyAllDone"
          title="Слов пока нет"
          headingAs="h2"
          actions={
            <ButtonLink block href={paths.learn}>
              На тропу
            </ButtonLink>
          }
        >
          Они появятся после урока.
        </EmptyState>
      ) : null}

      {review ? (
        <section className="review-card words__review" aria-labelledby="words-review-title">
          <div className="review-card__row">
            <Bee frame="beeRead" width={60} className="review-card__bee" />
            <div>
              <h2 className="review-card__title" id="words-review-title">
                Повторить {review} {plural(review, ["слово", "слова", "слов"])}
              </h2>
            </div>
          </div>
          <ButtonLink block href={paths.review} icon={<ArrowsClockwise weight="bold" aria-hidden />}>
            Начать
          </ButtonLink>
        </section>
      ) : null}

      {toReview.length ? <WordList title="На повторение" words={toReview} /> : null}
      {learned.length ? <WordList title="Выучено" words={learned} /> : null}
    </>
  );
}

function WordList({ title, words }: { title: string; words: MyWord[] }) {
  const id = `words-${title === "Выучено" ? "learned" : "review"}`;
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
            <SpeakButton sources={localAudio(w.word.audio)} size="small" label={`Послушать: ${w.word.text}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
