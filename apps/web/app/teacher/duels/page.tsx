"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink, Card, EmptyState, Illustration, ProgressBar, Skeleton, SkeletonGroup, useToast } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { ApiProblem, describeProblem, isNetworkError } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { Duel } from "../../_components/learn/Duel";
import { uuidv7 } from "../../_components/learn/ids";
import { LoadError } from "../../_components/screens";
import { TeacherShell } from "../TeacherShell";
import { useTeacherGate } from "../useTeacher";
import { VoteResults } from "./VoteResults";
import { pairsWord, type CorpusDuel, type CorpusItemVotes, type DuelChoice } from "./votes";

/** Сколько пар брать за один заход (контракт: 1–10, по умолчанию 3). */
const BATCH = 3;

const duelsApi = {
  list: () => unwrap(api.GET("/api/v1/corpus/duels", { params: { query: { limit: BATCH } } })),
  vote: (body: { judgmentId: string; itemId: string; shown: [string, string]; choice: DuelChoice; latencyMs: number }) => unwrap(api.POST("/api/v1/corpus/judgments", { body })),
  votes: (itemId: string) => unwrap(api.GET("/api/v1/corpus/items/{id}/votes", { params: { path: { id: itemId } } })),
};

const shownOf = (d: CorpusDuel): [string, string] => [d.variants[0]!.variantId, d.variants[1]!.variantId];

/**
 * «Помогите языку» для учителя (docs/plans/M2.md §1, шаг 5): та же дуэль, что у детей в уроке, — компонент Duel. Одна
 * колонка по центру: до голоса — дуэль, после — на её месте голоса по группам числами и статус словами продукта: «Ещё
 * собираем голоса», «Пару приняли» или «Мнения разошлись» (правила подсчёта на экране не объясняются). Детям распределение голосов не показывается (защита от конформизма), учителю — только после его
 * собственного голоса. Клавиши 1–4 и Enter работают без подсказки на экране.
 */
export default function TeacherDuelsPage() {
  const { me } = useTeacherGate("verified");
  const toast = useToast();
  const [round, setRound] = useState(0);
  const duels = useResource(() => duelsApi.list(), [me?.id, round], { enabled: Boolean(me) });
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<DuelChoice | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CorpusItemVotes | null>(null);
  const [votedCount, setVotedCount] = useState(0);
  const judgmentId = useRef(uuidv7());
  const shownAt = useRef(Date.now());
  const duelHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const items = duels.data?.items ?? [];
  const duel: CorpusDuel | undefined = items[index];
  const loading = !me || (duels.loading && !duels.data);

  // Новая пара: новый judgmentId (повтор отправки той же пары — тот же id, сервер не засчитает дважды) и время показа.
  useEffect(() => {
    judgmentId.current = uuidv7();
    shownAt.current = Date.now();
  }, [duel?.itemId]);

  const vote = useCallback(async () => {
    if (!duel || !choice || sending || result) return;
    setSending(true);
    try {
      const votes = await duelsApi.vote({ judgmentId: judgmentId.current, itemId: duel.itemId, shown: shownOf(duel), choice, latencyMs: Date.now() - shownAt.current });
      setResult(votes);
      setVotedCount((n) => n + 1);
    } catch (e) {
      // Уже голосовали за эту пару (например, в другой вкладке) — показываем голоса, а не ошибку.
      if (e instanceof ApiProblem && e.status === 409) {
        try {
          setResult(await duelsApi.votes(duel.itemId));
        } catch (e2) {
          toast(describeProblem(e2), "error");
        }
      } else {
        toast(isNetworkError(e) ? "Нет связи. Голос не отправлен, попробуйте ещё раз." : describeProblem(e), "error");
      }
    } finally {
      setSending(false);
    }
  }, [duel, choice, sending, result, toast]);

  const next = useCallback(() => {
    setChoice(null);
    setResult(null);
    if (index + 1 < items.length) setIndex(index + 1);
    else {
      // Пары захода кончились — берём новые: сервер отдаёт только те, за которые вы ещё не голосовали.
      setIndex(0);
      setRound((r) => r + 1);
    }
  }, [index, items.length]);

  // Фокус: после голоса — на «Голоса по группам» (читалка объявит итог), на новой паре — на вопрос дуэли.
  const layout = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!result) return;
    resultHeading.current?.focus({ preventScroll: true });
    revealResults(layout.current, resultHeading.current?.closest("section") ?? null);
  }, [result]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (duel) duelHeading.current?.focus({ preventScroll: true });
  }, [duel?.itemId, round]);

  // Enter: отдать голос, после голоса — следующая пара (кнопки и ссылки обрабатывают Enter сами).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("button, a, input, textarea, select") || document.querySelector("dialog[open]")) return;
      if (result) next();
      else if (choice) void vote();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [result, choice, next, vote]);

  return (
    <TeacherShell>
      <div className="tt-stack tt-stack--loose duels-page">
        <header className="duels-page__head">
          {/* Вопрос дуэли — в карточке («Какой перевод звучит естественнее?»): подзаголовок его не повторяет. */}
          <h1 className="tt-title1">Помогите языку</h1>
          <Illustration name="sceneDuel" width={150} className="duels-page__art" />
        </header>

        {duels.error && !duels.data ? (
          <LoadError error={duels.error} onRetry={duels.reload} home="/teacher" />
        ) : loading ? (
          <SkeletonGroup label="Загружаем пары" className="duels-layout">
            <Skeleton height={14} radius="button" />
            <Skeleton height={460} radius="card" />
          </SkeletonGroup>
        ) : !duel ? (
          <EmptyState
            art="emptyAllDone"
            headingAs="h2"
            title="Все пары оценены"
            actions={
              <ButtonLink href="/teacher" block>
                К моим классам
              </ButtonLink>
            }
          >
            {votedCount ? `Вы оценили ${votedCount} ${pairsWord(votedCount)}. ` : null}
            Новые пары появятся позже.
          </EmptyState>
        ) : (
          <div ref={layout} className="duels-layout">
            <ProgressBar value={index + (result ? 1 : 0)} max={items.length} label="Пары этого захода" valueText={`Пара ${index + 1} из ${items.length}`} showValue />
            {result ? (
              <VoteResults votes={result} shown={shownOf(duel)} headingRef={resultHeading} />
            ) : (
              <Card className="teacher-duel">
                <Duel
                  sourceRu={duel.sourceRu}
                  a={duel.variants[0]!.text}
                  b={duel.variants[1]!.text}
                  value={choice}
                  onChange={setChoice}
                  disabled={sending}
                  keyboard
                  headingAs="h2"
                  headingRef={duelHeading}
                  chipLabel="Помогите языку"
                  art={false}
                />
              </Card>
            )}
            {result ? (
              <Button block variant="violet" onClick={next}>
                {index + 1 < items.length ? "Следующая пара" : "Ещё пары"}
              </Button>
            ) : (
              <Button block variant="violet" disabled={!choice} loading={sending} onClick={() => void vote()}>
                Отдать голос
              </Button>
            )}
          </div>
        )}
      </div>
    </TeacherShell>
  );
}

/**
 * После голоса «Голоса по группам» встают на место дуэли, и ничего не обрезано липкой шапкой: если всё помещается с верха
 * страницы — прокрутка наверх (видно и заголовок «Помогите языку»), иначе — к началу колонки (полоса пар и голоса). Место
 * под шапкой задаёт scroll-padding-top (teacher.css).
 */
function revealResults(layout: HTMLElement | null, card: HTMLElement | null) {
  if (!layout || !card) return;
  const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (card.getBoundingClientRect().bottom + window.scrollY <= window.innerHeight) {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior });
    return;
  }
  layout.scrollIntoView({ block: "start", behavior });
}
