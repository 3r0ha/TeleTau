"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react/ssr";
import { AnswerOptions, Bee, Chip, LetterPanel, SpeakButton, WordTile, type IllustrationName } from "@teletau/ui";
import { localAudio } from "./audio";
import { playSound } from "./sound";
import { useDigitKeys } from "./keys";
import type { Answer, AttemptResult, ChoiceExercise, FreeExercise, PairLink, PairsExercise, PromptHint, TilesExercise, WordIntroExercise } from "./model";

export interface ExerciseProps<E> {
  exercise: E;
  /** Ответ готов к проверке (или null — ещё нечего проверять). */
  onAnswer: (answer: Answer | null) => void;
  /** Ученик открыл подсказку к слову условия (номер в hints): ответ уйдёт с hintsUsed — слово вернётся в повторение раньше. */
  onHint?: (index: number) => void;
  /** Enter в поле ввода — «Проверить». */
  onSubmit: () => void;
  /** Ответ проверяется или проверен — менять нельзя. */
  disabled: boolean;
  /** Упражнение вернулось после ошибки. */
  retry: boolean;
  /** Забег повторения слов: метка «Повторение» вместо «Новое слово». */
  review?: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  /** Вердикт сервера после «Проверить» — ответ подсвечивается: верно, почти или не так. */
  result?: AttemptResult | null;
}

/** Тон подсветки ответа после проверки. */
function tone(result: AttemptResult | null | undefined): "ok" | "almost" | "bad" | undefined {
  if (!result) return undefined;
  if (result.verdict === "wrong") return "bad";
  if (result.verdict === "almost") return "almost";
  return result.verdict === "recorded" ? undefined : "ok";
}

/**
 * Метка над заголовком (prototype .chip) — только когда она что-то добавляет к заголовку: задание вернулось после
 * ошибки («Ещё раз») или это повторение слов. Тип задания уже назван заголовком — второй раз его не пишем.
 */
function Kind({ retry, review }: { retry: boolean; review?: boolean }) {
  if (retry) return <Chip icon={<ArrowsClockwise weight="bold" aria-hidden />}>Ещё раз</Chip>;
  if (review) return <Chip icon={<ArrowsClockwise weight="bold" aria-hidden />}>Повторение</Chip>;
  return null;
}

function Title({ headingRef, children }: { headingRef: Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <h1 ref={headingRef} tabIndex={-1} className="task-title tt-step-heading">
      {children}
    </h1>
  );
}

/**
 * Пчела с репликой-пузырём (prototype .prompt): русская фраза, которую переводим. Пчела плавает вверх-вниз (и моргает,
 * когда появятся кадры, design/prompts/batch-3-animation.md). В режиме «Хранитель» — без пчелы.
 */
function Prompt({ bee, children }: { bee: IllustrationName; children: ReactNode }) {
  return (
    <div className="prompt">
      <Bee frame={bee} width={104} className="prompt__bee" float />
      <p className="prompt__bubble">{children}</p>
    </div>
  );
}

/** Отступ пузыря подсказки от края экрана. */
const HINT_GUTTER = 12;

/**
 * Слово условия с подсказкой: пунктирное подчёркивание, нажатие или Enter открывает пузырь с переводом
 * из словаря курса. Пузырь не уходит за край экрана — сдвигается, хвостик остаётся у слова.
 */
function HintWord({ hint, open, onToggle }: { hint: PromptHint; open: boolean; onToggle: () => void }) {
  const id = useId();
  const pop = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    el.style.setProperty("--hint-shift", "0px");
    const r = el.getBoundingClientRect();
    const right = document.documentElement.clientWidth - HINT_GUTTER;
    const shift = r.left < HINT_GUTTER ? HINT_GUTTER - r.left : r.right > right ? right - r.right : 0;
    el.style.setProperty("--hint-shift", `${Math.round(shift)}px`);
  }, [open]);
  return (
    <span className={["hint", open && "hint--open"].filter(Boolean).join(" ")}>
      <button type="button" className="hint__word" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        {hint.text}
      </button>
      {open ? (
        <span ref={pop} id={id} role="tooltip" className="hint__pop">
          <span lang="ba">{hint.translation.text}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * Русское условие с подсказками к словам (hints из контракта — по порядку, без пересечений). Открыт один пузырь;
 * нажатие мимо или Escape закрывает его. Читалка слышит перевод из живой области. Каждое открытие сообщается onOpen.
 */
function HintedText({ text, hints, onOpen }: { text: string; hints?: PromptHint[]; onOpen?: (index: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (open === null) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!hints?.length) return <>{text}</>;

  const parts: ReactNode[] = [];
  let at = 0;
  hints.forEach((hint, i) => {
    const k = text.indexOf(hint.text, at);
    if (k < 0 || !hint.text) return;
    if (k > at) parts.push(text.slice(at, k));
    const toggle = () => {
      if (open !== i) onOpen?.(i);
      setOpen(open === i ? null : i);
    };
    parts.push(<HintWord key={i} hint={hint} open={open === i} onToggle={toggle} />);
    at = k + hint.text.length;
  });
  if (at < text.length) parts.push(text.slice(at));
  const shown = open === null ? undefined : hints[open];
  return (
    <span ref={root} className="hinted">
      {parts}
      <span className="tt-visually-hidden" aria-live="polite">
        {shown ? <span lang="ba">{shown.translation.text}</span> : null}
      </span>
    </span>
  );
}

/**
 * «Новое слово» (word_intro): слово крупно, «Послушать» (если есть запись носителя), перевод и пчела-учитель — перед
 * упражнениями с этим словом. Ответа нет: «Дальше» в подвале урока.
 */
export function WordIntro({ exercise, headingRef }: { exercise: WordIntroExercise; headingRef: Ref<HTMLHeadingElement> }) {
  const text = exercise.word.text;
  return (
    <>
      <Title headingRef={headingRef}>Новое слово</Title>
      <div className="newword">
        <Bee frame="beeTeacher" width={160} className="newword__bee" float />
        <div className="newword__card">
          <div className="newword__head">
            <p className={["newword__word", [...text].length > 14 && "newword__word--long"].filter(Boolean).join(" ")} lang="ba">
              {text}
            </p>
            <SpeakButton sources={localAudio(exercise.word.audio)} />
          </div>
          <p className="newword__ru">{exercise.translationRu}</p>
        </div>
      </div>
    </>
  );
}

/** «Переведи на башкирский» — собери ответ из плиток (tiles_ru_ba, prototype 05–06). */
export function TilesTask({ exercise, onAnswer, onHint, disabled, retry, review, headingRef, result }: ExerciseProps<TilesExercise>) {
  const [picked, setPicked] = useState<string[]>([]);
  // Ответ сообщается в том же событии, что и выбор: «Проверить» и Enter видят его сразу, без лишней отрисовки.
  const update = (next: string[]) => {
    setPicked(next);
    onAnswer(next.length ? { type: "tiles", tileIds: next } : null);
    playSound("tap");
  };
  const verdict = tone(result);
  const text = (id: string) => exercise.tiles.find((t) => t.id === id)?.text ?? "";
  return (
    <>
      <Kind retry={retry} review={review} />
      <Title headingRef={headingRef}>Переведи на башкирский</Title>
      <Prompt bee="beeExplain">
        <HintedText text={exercise.promptRu} hints={exercise.hints} onOpen={onHint} />
      </Prompt>
      {/* Нажатие на плитку ответа возвращает её в банк. */}
      <div className={["tiles-answer", verdict && `tiles-answer--${verdict}`].filter(Boolean).join(" ")} role="group" aria-label="Твой ответ — нажми на слово, чтобы убрать">
        {picked.length === 0 ? (
          <span className="tiles-answer__hint" aria-hidden>
            Нажимай на слова внизу
          </span>
        ) : null}
        {picked.map((id, k) => (
          <WordTile key={id} pop={k === picked.length - 1} disabled={disabled} onClick={() => update(picked.filter((x) => x !== id))}>
            {text(id)}
          </WordTile>
        ))}
      </div>
      <div className="tiles-bank" role="group" aria-label="Слова">
        {exercise.tiles.map((t) => (
          <WordTile key={t.id} used={picked.includes(t.id)} disabled={disabled} onClick={() => update([...picked, t.id])}>
            {t.text}
          </WordTile>
        ))}
      </div>
    </>
  );
}

/** «Что значит это слово?» — узнавание при первом знакомстве (choice_ba_ru, prototype 07): клавиши 1–4. */
export function ChoiceTask({ exercise, onAnswer, disabled, retry, review, headingRef, result }: ExerciseProps<ChoiceExercise>) {
  const [choice, setChoice] = useState<string | null>(null);
  const pick = (optionId: string | undefined) => {
    if (!optionId) return;
    setChoice(optionId);
    onAnswer({ type: "choice", optionId });
  };
  useDigitKeys(exercise.options.length, (i) => pick(exercise.options[i]?.id), !disabled);
  // После проверки: верный вариант — зелёный, выбранный неверный — коралловый.
  const verdicts: Record<string, "ok" | "bad"> = {};
  if (result?.correctOptionId) verdicts[result.correctOptionId] = "ok";
  if (result && choice && choice !== result.correctOptionId && result.verdict === "wrong") verdicts[choice] = "bad";
  return (
    <>
      <Kind retry={retry} review={review} />
      <Title headingRef={headingRef}>Что значит это слово?</Title>
      <div className="word-card">
        <p className="word-card__text" lang="ba">
          {exercise.prompt}
        </p>
        {/* Запись носителя из контента; без записи кнопки нет. */}
        <SpeakButton sources={localAudio(exercise.promptAudio)} />
      </div>
      <AnswerOptions
        label="Варианты перевода"
        options={exercise.options.map((o, i) => ({ value: o.id, mark: String(i + 1), label: o.textRu }))}
        value={choice}
        onChange={pick}
        disabled={disabled}
        verdicts={result ? verdicts : undefined}
      />
    </>
  );
}

/** «Напиши по-башкирски» — ввод с панелью башкирских букв (free_ru_ba, prototype 08–09). Enter — проверить. */
export function FreeTask({ exercise, onAnswer, onHint, onSubmit, disabled, retry, review, headingRef, result }: ExerciseProps<FreeExercise>) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const update = (next: string) => {
    setText(next);
    onAnswer(next.trim() ? { type: "text", text: next } : null);
  };
  // На компьютере сразу в поле; на телефоне клавиатура не выскакивает сама — ребёнок сначала читает задание.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) field.current?.focus({ preventScroll: true });
  }, []);
  // После вставки буквы курсор встаёт сразу за ней.
  useEffect(() => {
    if (caret.current === null || !field.current) return;
    field.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  const insert = (letter: string) => {
    const el = field.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    caret.current = start + letter.length;
    update(text.slice(0, start) + letter + text.slice(end));
    el?.focus({ preventScroll: true });
  };

  return (
    <>
      <Kind retry={retry} review={review} />
      <Title headingRef={headingRef}>Напиши по-башкирски</Title>
      <Prompt bee="beeThink">
        <HintedText text={exercise.promptRu} hints={exercise.hints} onOpen={onHint} />
      </Prompt>
      <div className="answer-field" data-verdict={tone(result)}>
        <textarea
          ref={field}
          lang="ba"
          aria-label={`Перевод на башкирский: ${exercise.promptRu}`}
          placeholder="Твой ответ"
          value={text}
          readOnly={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!disabled) onSubmit();
            }
          }}
        />
      </div>
      <LetterPanel letters={exercise.letters.length ? exercise.letters : undefined} onInsert={insert} disabled={disabled} />
    </>
  );
}

/** Цвет пары по порядку соединения: цвет — вместе с номером, статус не передаётся одним цветом. */
const PAIR_TONES = 5;

/**
 * «Соедини пары» (match_pairs, docs/02 §3): слева башкирские слова, справа переводы. Нажми слово, затем перевод (или
 * наоборот) — пара получает номер и цвет; нажатие на соединённое снимает пару. Когда соединены все — «Проверить».
 * Верные пары знает только сервер: после проверки (result) каждая пара отмечается «верно» или «не так».
 */
export function PairsTask({ exercise, onAnswer, disabled, retry, review, headingRef, result }: ExerciseProps<PairsExercise>) {
  const [links, setLinks] = useState<PairLink[]>([]);
  const [picked, setPicked] = useState<{ side: "left" | "right"; id: string } | null>(null);

  const update = (next: PairLink[]) => {
    setLinks(next);
    onAnswer(next.length === exercise.left.length ? { type: "pairs", pairs: next } : null);
  };
  const tap = (side: "left" | "right", id: string) => {
    const linked = links.find((l) => l[side] === id);
    if (linked) {
      update(links.filter((l) => l !== linked));
      setPicked({ side, id });
      return;
    }
    if (picked && picked.side !== side) {
      const link = side === "left" ? { left: id, right: picked.id } : { left: picked.id, right: id };
      update([...links, link]);
      setPicked(null);
      playSound("tap");
      return;
    }
    setPicked(picked?.side === side && picked.id === id ? null : { side, id });
  };

  const correct = new Map((result?.correctPairs ?? []).map((p) => [p.left, p.right]));
  const verdictOf = (link: PairLink | undefined) => (!result || !link ? undefined : correct.get(link.left) === link.right ? "ok" : "bad");

  const item = (side: "left" | "right", id: string, text: string, lang?: string) => {
    const index = links.findIndex((l) => l[side] === id);
    const link = links[index];
    const verdict = verdictOf(link);
    const selected = picked?.side === side && picked.id === id;
    // Для читалки: имя — само слово, описание — номер пары и после проверки — верно ли.
    const status = [index >= 0 && `пара ${index + 1}`, verdict === "ok" && "верно", verdict === "bad" && "не так"].filter(Boolean).join(", ");
    const statusId = `${exercise.id}-${side}-${id}`;
    const cls = [
      "pair",
      selected && "pair--picked",
      index >= 0 && `pair--linked pair--t${index % PAIR_TONES}`,
      verdict && `pair--${verdict}`,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <li key={id}>
        <button type="button" className={cls} aria-pressed={selected} aria-describedby={status ? statusId : undefined} disabled={disabled} onClick={() => tap(side, id)}>
          {index >= 0 ? (
            <span className="pair__mark" aria-hidden>
              {index + 1}
            </span>
          ) : null}
          <span className="pair__text" lang={lang}>
            {text}
          </span>
        </button>
        {status ? (
          <span id={statusId} className="tt-visually-hidden">
            {status}
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <Kind retry={retry} review={review} />
      <Title headingRef={headingRef}>Соедини пары</Title>
      <p className="pairs__hint">Нажми слово и его перевод</p>
      <div className="pairs">
        <ul className="pairs__col" aria-label="Слова">
          {exercise.left.map((w) => item("left", w.id, w.text, "ba"))}
        </ul>
        <ul className="pairs__col" aria-label="Переводы">
          {exercise.right.map((r) => item("right", r.id, r.textRu))}
        </ul>
      </div>
    </>
  );
}
