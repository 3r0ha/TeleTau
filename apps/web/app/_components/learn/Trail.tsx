"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowsClockwise, Barbell, BookOpen, ChalkboardTeacher, ChatCircleText, Check, CheckCircle, CircleNotch, LockSimple, Scales, Star, Trophy } from "@phosphor-icons/react/ssr";
import { Bee, Button, EmptyState, HexNode, ProgressBar, SvgBee, illustrations, useReducedMotion } from "@teletau/ui";
import { serverNow } from "@teletau/session/clock";
import { assignmentTitle, dueForStudent, ufaDay } from "../assignments";
import type { Course, CourseNode, CourseUnit, NodeIcon } from "./model";
import { plural } from "./format";
import { JumpOffer } from "./Jump";
import { BUBBLE_GAP, NODE_MID, NODE_ROW, offsetOf, placeArt, type PlaceTone } from "./places";

/** Верх ряда узла: перед текущим узлом — запас под пузырь «Начать», чтобы он не наезжал на подпись предыдущего. */
const rowTop = (i: number, cur: number) => i * NODE_ROW + (cur >= 0 && i >= cur ? BUBBLE_GAP : 0);

const ICONS: Record<NodeIcon, typeof Star> = { star: Star, "chat-circle-text": ChatCircleText, "book-open": BookOpen, barbell: Barbell };
const ICON_CYCLE: NodeIcon[] = ["star", "chat-circle-text", "book-open", "barbell"];
const STATE_NAMES: Record<CourseNode["state"], string> = { done: "пройден", current: "следующий", open: "доступен", locked: "закрыт" };

function nodeIcon(node: CourseNode, i: number) {
  if (node.kind === "help_language") return <Scales weight="fill" />;
  if (node.kind === "place_test") return node.state === "done" ? <Check weight="bold" /> : <Trophy weight="fill" />;
  if (node.state === "done") return <Check weight="bold" />;
  const Icon = ICONS[node.icon ?? ICON_CYCLE[i % ICON_CYCLE.length]!];
  return <Icon weight="fill" />;
}

function nodeLabel(node: CourseNode): string {
  const what = node.kind === "lesson" ? `Урок «${node.titleRu}»` : node.titleRu;
  if (node.state === "current") return `${what} — начать`;
  // Засчитан сданным испытанием для перехода (docs/02 §2) — выглядит как пройденный.
  return `${what}, ${node.passedByTest ? "пройден испытанием" : STATE_NAMES[node.state]}`;
}

/** Текущее место экспедиции: юнит с текущим узлом, иначе первый незаконченный открытый, иначе последний открытый. */
export function currentUnit(course: Course): CourseUnit | undefined {
  return (
    course.units.find((u) => u.nodes.some((n) => n.state === "current")) ??
    course.units.find((u) => u.state === "open" && u.nodes.some((n) => n.state !== "done")) ??
    [...course.units].reverse().find((u) => u.state === "open")
  );
}

export function nextNode(course: Course): CourseNode | undefined {
  const all = course.units.flatMap((u) => u.nodes);
  return all.find((n) => n.state === "current") ?? all.find((n) => n.state === "open");
}

/** Название места: башкирское (lang="ba", из контента с флагом проверки носителем), иначе русское. */
export function PlaceName({ place }: { place: CourseUnit["place"] }) {
  return place.titleBa ? <span lang="ba">{place.titleBa.text}</span> : <>{place.titleRu}</>;
}

interface TrailProps {
  course: Course;
  onStart: (node: CourseNode) => void;
  /** Узел, который только что запечатан (анимация «штампа»). */
  sealed?: string;
  /** Узел, урок которого сейчас открывается. */
  busy?: string;
  /** Сколько слов пора повторить (GET /course → review.due); 0 — карточки «Повторить» нет. */
  reviewDue?: number;
  onReview?: () => void;
  /** Испытание для перехода к закрытому месту (unit.jump): кнопка под вывеской места (Jump.tsx). */
  onJump?: (unit: CourseUnit) => void;
}

/** Сколько держится подсказка у закрытого узла (медленно читающему нужно время). */
const HINT_MS = 6000;

/** Подсказка у закрытого узла: какой урок пройти сначала. */
function lockedHint(course: Course, nodeId: string): string {
  const all = course.units.flatMap((u) => u.nodes);
  const i = all.findIndex((n) => n.id === nodeId);
  const before = i > 0 ? all[i - 1] : undefined;
  if (before && (before.state === "current" || before.state === "open")) return `Сначала пройди «${before.titleRu}»`;
  return "Сначала пройди предыдущие уроки";
}

/** Полоса у верхнего края окна, под панелью со счётчиками: здесь липкий баннер юнита. Пока в ней плашки или шапка места, баннер не нужен. */
const TOP_ZONE = { from: 70, to: 140 };

const overlapsTopZone = (el: HTMLElement | null | undefined) => {
  const r = el?.getBoundingClientRect();
  return r ? r.top < TOP_ZONE.to && r.bottom > TOP_ZONE.from : false;
};

/**
 * Тропа «Тропа + Экспедиция» (prototype 01–04): места с узлами и декорациями. У текущего места вместо вывески —
 * компактная шапка (картинка-полоса, название, прогресс), над ним — плашки «на сегодня» (задание учителя, повторение).
 * Тропа видна с первого экрана; текущее место не первое — тропа открывается сразу на нём. Липкий баннер юнита
 * показывает место, мимо которого прокручиваем.
 */
export function Trail({ course, onStart, sealed, busy, reviewDue = 0, onReview, onJump }: TrailProps) {
  const unit = currentUnit(course);
  const next = nextNode(course);
  const reduced = useReducedMotion();
  // Нажали закрытый узел — пузырь «Сначала пройди…» над ним (и та же строка для читалки), сам исчезает.
  const [hint, setHint] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(t);
  }, [hint]);
  const onLocked = (node: CourseNode) => setHint({ id: node.id, text: lockedHint(course, node.id) });

  const placeIndex = unit ? course.units.findIndex((u) => u.id === unit.id) : -1;
  const unitRefs = useRef<Map<string, HTMLElement>>(new Map());
  const todayRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);

  // Открылась тропа. После урока — запечатанный узел в центре (а не верх страницы). Текущее место не первое — сразу
  // «ты здесь»: плашки, шапка места и его узлы под верхней панелью. Иначе — верх тропы.
  useLayoutEffect(() => {
    if (sealed) return;
    const here = todayRef.current ?? headRef.current;
    if (placeIndex <= 0 || !here) {
      window.scrollTo({ top: 0 });
      return;
    }
    const bar = document.querySelector(".learn-top")?.getBoundingClientRect().bottom ?? 0;
    window.scrollTo({ top: Math.max(0, here.getBoundingClientRect().top + window.scrollY - Math.max(0, bar) - 8) });
    // Только при появлении тропы.
  }, []);
  useEffect(() => {
    if (!sealed) return;
    const el = document.querySelector(`[data-node="${CSS.escape(sealed)}"]`);
    el?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    // Только при появлении тропы: sealed и reduced к этому моменту уже известны.
  }, []);

  const [bar, setBar] = useState<{ show: boolean; unitId: string | undefined }>({ show: false, unitId: unit?.id });
  // Липкий баннер юнита: место, мимо которого прокручиваем; не виден, пока у верхнего края плашки или шапка места.
  useEffect(() => {
    const update = () => {
      let unitId: string | undefined;
      for (const u of course.units) {
        const el = unitRefs.current.get(u.id);
        if (el && el.getBoundingClientRect().top < TOP_ZONE.to) unitId = u.id;
      }
      const show = Boolean(unitId) && !overlapsTopZone(todayRef.current) && !overlapsTopZone(headRef.current);
      setBar((b) => (b.show === show && (b.unitId === unitId || !unitId) ? b : { show, unitId: unitId ?? b.unitId }));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [course.units]);

  const barUnit = course.units.find((u) => u.id === bar.unitId) ?? unit;
  // Мест впереди — после текущего места. Состояние юнита (open/locked) — это опубликован ли контент, а не дошёл ли
  // ученик: открытый юнит 2 при незаконченном юните 1 тоже впереди.
  const ahead = placeIndex >= 0 ? course.units.length - placeIndex - 1 : course.units.filter((u) => u.state === "locked").length;
  // Всё открытое пройдено — сначала «На сегодня всё» (prototype 20-empty-done), тропа — по кнопке.
  const [showTrail, setShowTrail] = useState(false);
  const pills = <TodayPills ref={todayRef} course={course} busy={busy} onStart={onStart} reviewDue={reviewDue} onReview={onReview} />;
  if (!next && !showTrail) {
    return (
      <>
        {pills}
        <EmptyState
          art="emptyAllDone"
          title="На сегодня всё"
          actions={
            <Button block variant={reviewDue > 0 && onReview ? "secondary" : "primary"} onClick={() => setShowTrail(true)}>
              На тропу
            </Button>
          }
        >
          Все уроки пройдены. Новые скоро появятся.
        </EmptyState>
      </>
    );
  }

  return (
    <div className="trail">
      <p className="tt-visually-hidden" role="status">
        {hint?.text ?? ""}
      </p>
      {barUnit ? (
        <div className={["unit-bar", bar.show && "unit-bar--show"].filter(Boolean).join(" ")} aria-hidden="true">
          <div className={`unit-bar__inner unit-bar__inner--${placeArt(barUnit.place.slug).tone}`}>
            <small>
              <PlaceName place={barUnit.place} />
            </small>
            <b>{barUnit.topicRu}</b>
          </div>
        </div>
      ) : null}
      <div className="path">
        {placeIndex < 0 ? pills : null}
        {course.units.map((u, ui) => {
          const here = ui === placeIndex;
          return (
            <Fragment key={u.id}>
              {here ? pills : null}
              <section
                ref={(el) => {
                  if (el) unitRefs.current.set(u.id, el);
                  else unitRefs.current.delete(u.id);
                }}
                className={[`unit unit--${placeArt(u.place.slug).tone}`, here && "unit--here", here && u.nodes[0]?.state === "current" && "unit--start"].filter(Boolean).join(" ")}
                aria-label={`Место ${u.order} · ${u.place.titleRu} · ${u.topicRu}`}
              >
                {here ? <UnitHead ref={headRef} unit={u} /> : <PlaceSign unit={u} />}
                {u.jump && onJump ? <JumpOffer unit={u} onJump={onJump} busy={busy === u.id} /> : null}
                <UnitTrack unit={u} withBee={here} sealed={sealed} busy={busy} onStart={onStart} onLocked={onLocked} hint={hint} />
              </section>
            </Fragment>
          );
        })}
        {ahead > 0 ? (
          <div className="path-end">
            <Bee frame="beeFly" width={120} float />
            <p className="path-end__title">
              Впереди ещё {ahead} {plural(ahead, ["место", "места", "мест"])}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Шапка текущего места (вместо вывески): картинка-полоса справа, название, тема и сколько пройдено — две строки и полоса. */
function UnitHead({ unit, ref }: { unit: CourseUnit; ref: React.Ref<HTMLElement> }) {
  const art = placeArt(unit.place.slug);
  const done = unit.nodes.filter((n) => n.state === "done").length;
  const total = unit.nodes.length;
  const hero = art.hero ? illustrations[art.hero] : undefined;
  return (
    <header ref={ref} className="unit-head">
      {hero ? <img className="unit-head__art" src={hero.src} width={hero.width} height={hero.height} alt="" /> : null}
      <div className="unit-head__body">
        <h1 className="unit-head__title" id="unit-head-title">
          {unit.place.titleBa ? (
            <>
              <span lang="ba">{unit.place.titleBa.text}</span> <small>{unit.place.titleRu}</small>
            </>
          ) : (
            unit.place.titleRu
          )}
        </h1>
        <p className="unit-head__topic">
          {unit.topicRu} · <span aria-hidden>{`${done} из ${total}`}</span>
        </p>
      </div>
      {/* Сколько пройдено — тонкой медовой полосой по нижнему краю шапки. */}
      <ProgressBar value={done} max={total} label="Пройдено на этом месте" valueText={`${done} из ${total}`} />
    </header>
  );
}

/**
 * Плашки «на сегодня» над текущим местом: задание учителя (ADR 0021) и повторение слов — по строке, нажатие
 * начинает урок. Выполненное задание — зелёная строка с галочкой. Просроченных заданий здесь нет (сервер их не
 * отдаёт) — ребёнка не торопим и не стыдим. На компьютере плашки — карточками в правой колонке (shell.css).
 */
function TodayPills({
  course,
  busy,
  onStart,
  reviewDue,
  onReview,
  ref,
}: {
  course: Course;
  busy?: string;
  onStart: (node: CourseNode) => void;
  reviewDue: number;
  onReview?: () => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  const list = [...(course.assignments ?? [])].sort((a, b) => Number(a.done) - Number(b.done));
  const review = reviewDue > 0 && onReview;
  if (!list.length && !review) return null;
  const today = ufaDay(serverNow());
  const nodes = course.units.flatMap((u) => u.nodes);
  return (
    <div ref={ref} className="today">
      {list.map((a) => {
        const titleId = `task-${a.id}`;
        if (a.done) {
          return (
            <section key={a.id} className="today-pill today-pill--done" aria-labelledby={titleId}>
              <span className="today-pill__icon" aria-hidden>
                <CheckCircle weight="fill" />
              </span>
              <span className="today-pill__text">
                <span className="today-pill__kicker">Задание учителя выполнено </span>
                <span className="today-pill__title" id={titleId}>
                  {assignmentTitle(a)}
                </span>
              </span>
            </section>
          );
        }
        const node = a.lessonId ? nodes.find((n) => n.id === a.lessonId) : undefined;
        const start = a.kind === "review" ? onReview : node && node.state !== "locked" ? () => onStart(node) : undefined;
        return (
          <TodayPill
            key={a.id}
            tone="task"
            icon={<ChalkboardTeacher weight="fill" />}
            kicker={`Задание учителя · ${dueForStudent(a.dueOn, today)}`}
            title={assignmentTitle(a)}
            onClick={start}
            busy={Boolean(node && busy === node.id)}
          />
        );
      })}
      {review ? <TodayPill tone="review" icon={<ArrowsClockwise weight="bold" />} title={`Повторить ${reviewDue} ${plural(reviewDue, ["слово", "слова", "слов"])}`} onClick={onReview} /> : null}
    </div>
  );
}

function TodayPill({ tone, icon, kicker, title, onClick, busy }: { tone: "task" | "review"; icon: React.ReactNode; kicker?: string; title: string; onClick?: () => void; busy?: boolean }) {
  const body = (
    <>
      <span className="today-pill__icon" aria-hidden>
        {icon}
      </span>
      <span className="today-pill__text">
        {kicker ? <span className="today-pill__kicker">{kicker} </span> : null}
        <span className="today-pill__title">{title}</span>
      </span>
    </>
  );
  const cls = `today-pill today-pill--${tone}`;
  // Заданный урок ещё закрыт — плашка без действия (учитель откроет его сам).
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={`${cls} today-pill--action`} onClick={onClick} disabled={busy} aria-busy={busy || undefined}>
      {body}{" "}
      <span className="today-pill__go">
        {busy ? <CircleNotch weight="bold" className="tt-spin" aria-hidden /> : "Начать"}
      </span>
    </button>
  );
}

function PlaceSign({ unit }: { unit: CourseUnit }) {
  const art = placeArt(unit.place.slug);
  const sign = art.sign ? illustrations[art.sign] : undefined;
  const locked = unit.state === "locked";
  const allDone = unit.nodes.every((n) => n.state === "done");
  return (
    <div className={["place-sign", art.signOnDark && "place-sign--on-dark", !sign && "place-sign--plain"].filter(Boolean).join(" ")}>
      {sign ? <img className="place-sign__art" src={sign.src} width={sign.width} height={sign.height} alt="" /> : null}
      <div className="place-sign__text">
        <span className="place-sign__chip">
          {locked ? <LockSimple weight="fill" aria-hidden /> : allDone ? <Check weight="bold" aria-hidden /> : null}
          Место {unit.order}
          {locked ? <span className="tt-visually-hidden">, закрыто</span> : null}
        </span>
        <h2 className="place-sign__name">
          <PlaceName place={unit.place} />
        </h2>
        <span className="place-sign__topic">{unit.topicRu}</span>
      </div>
    </div>
  );
}

function UnitTrack({
  unit,
  withBee,
  sealed,
  busy,
  onStart,
  onLocked,
  hint,
}: {
  unit: CourseUnit;
  withBee: boolean;
  sealed?: string;
  busy?: string;
  onStart: (node: CourseNode) => void;
  onLocked: (node: CourseNode) => void;
  hint: { id: string; text: string } | null;
}) {
  return (
    <div className="track">
      <TrackArt unit={unit} withBee={withBee} />
      <ol className="track__nodes">
        {unit.nodes.map((node, i) => {
          const tone = node.kind === "help_language" ? "violet" : "honey";
          return (
            <li key={node.id} className={["track__row", node.state === "current" && i > 0 && "track__row--current"].filter(Boolean).join(" ")}>
              <div className={["track__node", `track__node--o${i % 8}`, hint?.id === node.id && "track__node--nope"].filter(Boolean).join(" ")} data-node={node.id}>
                {node.state === "current" ? (
                  <span className="track__bubble" aria-hidden>
                    Начать
                  </span>
                ) : null}
                <HexNode
                  state={node.state}
                  tone={tone}
                  icon={nodeIcon(node, i)}
                  label={nodeLabel(node)}
                  sealed={sealed === node.id}
                  onClick={node.state === "locked" ? () => onLocked(node) : busy ? undefined : () => onStart(node)}
                />
                {hint?.id === node.id ? (
                  <span className="track__hint" aria-hidden>
                    <LockSimple weight="fill" />
                    {hint.text}
                  </span>
                ) : null}
                {node.titleRu ? (
                  <span className={`track__cap track__cap--${node.state}`} aria-hidden>
                    {node.titleRu}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Нарисованная тропинка (медовая там, где пройдено, песочная — впереди), декорации места и пчела у текущего узла —
 * одна SVG под узлами, все позиции — атрибутами (строгая CSP не применяет style). Движение (learn.css): последний
 * отрезок медовой тропинки дорисовывается до текущего узла (маска с pathLength), декорации покачиваются, пчела плавает.
 */
function TrackArt({ unit, withBee }: { unit: CourseUnit; withBee: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskId = `walk-${uid}`;
  const nodes = unit.nodes;
  const curRaw = nodes.findIndex((n) => n.state === "current");
  // Запас под пузырь — только если текущий узел не первый (у первого пузырь и так над тропой).
  const gapAt = curRaw > 0 ? curRaw : -1;
  const height = rowTop(nodes.length, gapAt);
  const pts: [number, number][] = [[0, -48], ...nodes.map((_, i): [number, number] => [offsetOf(i), rowTop(i, gapAt) + NODE_MID]), [0, height - 20]];
  const seg = (a: [number, number], b: [number, number]) => `C${a[0]},${a[1] + (b[1] - a[1]) / 2} ${b[0]},${b[1] - (b[1] - a[1]) / 2} ${b[0]},${b[1]}`;
  const path = (from: number, to: number) => {
    let d = `M${pts[from]![0]},${pts[from]![1]}`;
    for (let k = from; k < to; k++) d += seg(pts[k]!, pts[k + 1]!);
    return d;
  };
  const cur = curRaw;
  const lastDone = nodes.reduce((acc, n, i) => (n.state === "done" ? i : acc), -1);
  const allDone = nodes.length > 0 && lastDone === nodes.length - 1;
  // Индекс точки в pts, до которой тропинка пройдена (pts смещены на 1 из-за начальной точки).
  const walked = allDone ? pts.length - 1 : cur >= 0 ? cur + 1 : lastDone >= 0 ? lastDone + 1 : 0;
  // Дорисовывается только отрезок к текущему узлу; пройденное до него уже нарисовано.
  const drawing = cur >= 0 && walked > 0;
  const art = placeArt(unit.place.slug);
  const beeW = 92;
  const bee = illustrations.beeIdle;
  const beeH = Math.round((bee.height / bee.width) * beeW);
  const beeAt = withBee && cur >= 0 ? cur : -1;
  const decos = art.decos.filter((d) => d.y < height + 40);
  return (
    <svg className="track__art" width={360} height={height} viewBox={`-180 0 360 ${height}`} aria-hidden focusable="false">
      <defs>
        {drawing ? (
          <mask id={maskId} className="track__mask" maskUnits="userSpaceOnUse" x={-180} y={-60} width={360} height={height + 80}>
            {walked > 1 ? <path className="track__reveal" d={path(0, walked - 1)} /> : null}
            <path className="track__reveal track__reveal--draw" d={path(walked - 1, walked)} pathLength={1} />
          </mask>
        ) : null}
        {/* Растворение низа декорации (Deco.fade): альфа-маска по высоте картинки. */}
        {decos.map((d, i) =>
          d.fade ? (
            <g key={i}>
              <linearGradient id={`tt-fade-g-${uid}-${i}`} x1={0} y1={0} x2={0} y2={1}>
                <stop offset={d.fade[0]} stopOpacity={1} />
                <stop offset={d.fade[1]} stopOpacity={0} />
              </linearGradient>
              <mask id={`tt-fade-${uid}-${i}`} className="track__mask" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x={0} y={0} width={1} height={1}>
                <rect width={1} height={1} fill={`url(#tt-fade-g-${uid}-${i})`} />
              </mask>
            </g>
          ) : null,
        )}
      </defs>
      {walked < pts.length - 1 ? (
        <g className="track__road track__road--ahead">
          <path className="track__road-base" d={path(walked, pts.length - 1)} />
          <path className="track__road-dash" d={path(walked, pts.length - 1)} />
        </g>
      ) : null}
      {walked > 0 ? (
        <g className="track__road track__road--walked" mask={drawing ? `url(#${maskId})` : undefined}>
          <path className="track__road-base" d={path(0, walked)} />
          <path className="track__road-dash" d={path(0, walked)} />
        </g>
      ) : null}
      {decos.map((d, i) => {
          const img = illustrations[d.art];
          const h = Math.round((img.height / img.width) * d.w);
          const transform = `translate(${d.x} ${d.y})${d.rot ? ` rotate(${d.rot})` : ""}${d.flip ? " scale(-1 1)" : ""}`;
          // Позиция — атрибутом transform у группы, движение — CSS-transform картинки внутри (они не перебивают друг друга).
          const cls = ["track__deco", d.motion && `track__deco--${d.motion} track__deco--phase${i % 4}`, d.shrinkWide && "track__deco--shrink"].filter(Boolean).join(" ");
          return (
            <g key={i} transform={transform}>
              <image className={cls} href={img.src} x={-d.w / 2} y={-h / 2} width={d.w} height={h} mask={d.fade ? `url(#tt-fade-${uid}-${i})` : undefined} />
            </g>
          );
        })}
      {beeAt >= 0 ? (
        <SvgBee
          frame="beeIdle"
          className="track__bee"
          float
          x={offsetOf(beeAt) + (offsetOf(beeAt) <= 0 ? 92 : -92) - beeW / 2}
          y={rowTop(beeAt, gapAt) + NODE_MID - beeH * 0.58}
          width={beeW}
        />
      ) : null}
    </svg>
  );
}

export type { PlaceTone };
