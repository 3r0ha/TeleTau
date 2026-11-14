"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { BookOpen, BookOpenText, CaretRight, ChalkboardTeacher, Drop, EnvelopeSimple, Fire, IdentificationCard, Moon, Scales, SignOut, SpeakerHigh, SpeakerSlash, Target } from "@phosphor-icons/react/ssr";
import { Button, Card, CardSub, CardTitle, Dialog, HexAvatar, HoneyComb, Illustration, InlineAlert, LinkButton, ThemeSwitch, avatarFor, hexPath, illustrations, toneFor } from "@teletau/ui";
import { describeProblem } from "@teletau/session/problem";
import { session } from "@teletau/session/client";
import { useResource } from "@teletau/session/react";
import type { Me } from "@teletau/session/types";
import { ClassTitle, LoadError, LoadingBlock } from "../screens";
import { LanguageRow } from "../LanguageSwitcher";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";
import { learnApi } from "./api";
import { plural } from "./format";
import { AchievementsCard } from "./Achievements";
import type { MyAchievements, MyCellsPage, MyProgress, MyWords } from "./model";
import { useStudentPaths } from "./paths";
import { StudentShell, studentClass, useStudent } from "./StudentShell";
import { asGoal, GoalPicker, goalTitle, type Goal } from "./GoalPicker";
import { selfApi } from "./self-api";
import { nextTeacherStep } from "../../teacher/useTeacher";
import { playSound, setSoundsOn, useSoundsOn } from "./sound";

/** «Звуки»: выключатель звуков урока на этом устройстве (запись носителя «Послушать» играет всегда). */
function SoundsRow() {
  const t = useT();
  const on = useSoundsOn();
  return (
    <div className="settings__row">
      {on ? <SpeakerHigh weight="fill" aria-hidden /> : <SpeakerSlash weight="fill" aria-hidden />}
      <span className="settings__name" id="sounds-label">
        {t("Звуки")}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="sounds-label"
        className="tt-switch"
        onClick={() => {
          setSoundsOn(!on);
          if (!on) playSound("correct");
        }}
      >
        <span className="tt-switch__knob" aria-hidden />
      </button>
    </div>
  );
}

function ThemeRow() {
  const t = useT();
  return (
    <div className="settings__row">
      <Moon weight="fill" aria-hidden />
      <span className="settings__name" id="theme-label">
        {t("Тёмная тема")}
      </span>
      <ThemeSwitch labelledBy="theme-label" />
    </div>
  );
}

/**
 * Вкладка «Профиль» (prototype 18-profile): серия, мёд, слова, голоса, «Мой вклад в словарь», настройки. Карточки
 * «Экспедиция» нет: места и прогресс уже на тропе (без повторов, docs/plans/M2-copy-student.md). Курс грузится только
 * для правой колонки на компьютере.
 */
export function ProfileScreen() {
  const account = useStudent();
  const t = useT();
  const enabled = Boolean(account);
  const progress = useResource(() => learnApi.progress(), [account?.id], { enabled });
  const cells = useResource(() => learnApi.myCells(), [account?.id], { enabled });
  const course = useResource(() => learnApi.course(), [account?.id], { enabled });
  // Словарь не обязателен для профиля: без него карточка «Мой словарь» — без чисел.
  const words = useResource(() => learnApi.words(), [account?.id], { enabled });
  // Награды тоже: не загрузились — профиль без них.
  const achievements = useResource(() => learnApi.achievements(), [account?.id], { enabled });
  const error = progress.error ?? cells.error;
  return (
    <StudentShell tab="me" className="profile" rail={{ progress: progress.data, course: course.data }}>
      {account && progress.data && cells.data ? (
        <ProfileView me={account} progress={progress.data} cells={cells.data} words={words.data} achievements={achievements.data} />
      ) : error ? (
        <LoadError
          error={error}
          audience="child"
          onRetry={() => {
            progress.reload();
            cells.reload();
          }}
        />
      ) : (
        <LoadingBlock rows={4} label={t("Загружаем профиль")} />
      )}
    </StudentShell>
  );
}

/** Аватар ника в шестиугольной рамке; ник не из словаря — значок приложения в шестиугольнике. */
function Avatar({ nickname }: { nickname?: string }) {
  const art = avatarFor(nickname);
  if (art) return <HexAvatar size={88} tone={toneFor(nickname ?? "")} art={art} lip />;
  return <AppIconAvatar />;
}

function AppIconAvatar() {
  const raw = useId();
  const clip = `ava-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const W = 88;
  const H = 77;
  return (
    <svg className="profile__avatar" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d={hexPath(W, H, 14)} />
        </clipPath>
      </defs>
      <image href={illustrations.appIconAlt.src} x={0} y={-6} width={W} height={W} clipPath={`url(#${clip})`} />
      <path className="profile__avatar-ring" d={hexPath(W - 4, H - 4, 12, 2, 2)} />
    </svg>
  );
}

function ProfileView({
  me,
  progress,
  cells,
  words: dictionary,
  achievements,
}: {
  me: Me;
  progress: MyProgress;
  cells: MyCellsPage;
  words?: MyWords;
  achievements?: MyAchievements;
}) {
  const router = useRouter();
  const paths = useStudentPaths();
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const klass = studentClass(me);
  // «Учусь сам» без карточки и без почты: после выхода вернуться в этот аккаунт будет нечем (ADR 0022).
  const noWayBack = me.loginCard === "none" && !me.profile && !klass;
  const { streak, honey } = progress;
  // Слова — как в «Моём словаре» (слова пройденных уроков); пока словарь не загрузился — счётчик профиля.
  const words = dictionary?.summary.total ?? progress.wordsLearned;
  const votes = progress.votes.total;
  const { matured, pending, honeyPending } = cells.summary;

  const cellsTotal = Math.min(24, matured + pending);

  return (
    <>
      <header className="profile__head">
        <Avatar nickname={me.nickname} />
        <div>
          <h1 className="page-title">{me.nickname}</h1>
          {klass ? (
            <p className="page-lead">
              <ClassTitle title={klass.title} /> · {klass.schoolName}
            </p>
          ) : null}
        </div>
      </header>

      <ul className="pstats" aria-label={t("Мои итоги")}>
        <li className="pstat">
          <Fire weight="fill" aria-hidden className="pstat__icon pstat__icon--streak" />
          <p>
            <b>{streak.current}</b>
            <span>{plural(streak.current, [t("день подряд"), t("дня подряд"), t("дней подряд")])}</span>
          </p>
        </li>
        <li className="pstat">
          <Drop weight="fill" aria-hidden className="pstat__icon pstat__icon--honey" />
          <p>
            <b>{honey.total}</b>
            <span>{t("мёда")}</span>
          </p>
        </li>
        <li className="pstat">
          <BookOpen weight="fill" aria-hidden className="pstat__icon pstat__icon--words" />
          <p>
            <b>{words}</b>
            <span>{plural(words, [t("слово"), t("слова"), t("слов")])}</span>
          </p>
        </li>
        <li className="pstat">
          <Scales weight="fill" aria-hidden className="pstat__icon pstat__icon--votes" />
          <p>
            <b>{votes}</b>
            <span>{plural(votes, [t("голос"), t("голоса"), t("голосов")])}</span>
          </p>
        </li>
      </ul>

      {achievements ? <AchievementsCard data={achievements} /> : null}

      <Link href={paths.words} className="dict-link">
        <span className="dict-link__icon" aria-hidden>
          <BookOpenText weight="fill" />
        </span>
        <span className="dict-link__text">
          <b>{t("Мой словарь")}</b>
          {dictionary ? (
            <span>
              {dictionary.summary.review
                ? t("Повторить {n} {word}", { n: dictionary.summary.review, word: plural(dictionary.summary.review, [t("слово"), t("слова"), t("слов")]) })
                : dictionary.summary.total
                  ? t("Все слова выучены")
                  : t("Пока пусто")}
            </span>
          ) : null}
        </span>
        <CaretRight weight="bold" aria-hidden className="dict-link__caret" />
      </Link>

      {/* «Учусь сам» (ADR 0022): вход с другого устройства — личная карточка; почту привязывают и дети, и взрослые (§10). */}
      {me.loginCard ? (
        <Link href={paths.card} className="dict-link dict-link--card">
          <span className="dict-link__icon" aria-hidden>
            <IdentificationCard weight="fill" />
          </span>
          <span className="dict-link__text">
            <b>{t("Моя карточка входа")}</b>
            <span>{me.loginCard === "issued" ? t("Вход с другого устройства") : t("Сохранит мёд и серию")}</span>
          </span>
          <CaretRight weight="bold" aria-hidden className="dict-link__caret" />
        </Link>
      ) : null}
      {!me.profile && !me.emailLogin ? (
        <Link href={paths.email} className="dict-link dict-link--email">
          <span className="dict-link__icon" aria-hidden>
            <EnvelopeSimple weight="fill" />
          </span>
          <span className="dict-link__text">
            <b>{t("Сохранить прогресс по почте")}</b>
            <span>{t("Вход с любого устройства")}</span>
          </span>
          <CaretRight weight="bold" aria-hidden className="dict-link__caret" />
        </Link>
      ) : null}

      <MaturedHoney accountId={me.id} cells={cells} />

      <Card as="section" className="tab-card cells-card" aria-labelledby="cells-title">
        {matured ? <Illustration name="sceneWordAccepted" width={96} className="cells-card__art" /> : null}
        <CardTitle id="cells-title">{t("Мой вклад в словарь")}</CardTitle>
        {cellsTotal ? (
          <>
            <CardSub>
              {[
                t("{n} в словаре", { n: matured }),
                pending ? t("{n} {word} итога", { n: pending, word: plural(pending, [t("ждёт"), t("ждут"), t("ждут")]) }) : null,
                honeyPending ? t("+{n} мёда созревает", { n: honeyPending }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </CardSub>
            <div className="tab-card__comb">
              <HoneyComb total={cellsTotal} filled={Math.min(matured, cellsTotal)} nectar={Math.max(0, cellsTotal - matured)} />
            </div>
          </>
        ) : (
          <CardSub>{t("Голосуй в «Помоги языку» на тропе.")}</CardSub>
        )}
      </Card>

      <Card as="section" className="tab-card settings" aria-label={t("Настройки")}>
        <div className="settings__row">
          <Target weight="fill" aria-hidden />
          <span className="settings__text">
            <span className="settings__name">{t("Цель дня")}</span>
            <span className="settings__val">{goalTitle(me.dailyGoal)}</span>
          </span>
          <LinkButton onClick={() => setGoalOpen(true)}>{t("Изменить")}</LinkButton>
        </div>
        <SoundsRow />
        <LanguageRow />
        {paths.prefix ? null : <ThemeRow />}
        {/* Заявка учителя — по почте: без неё сначала «Сохранить прогресс по почте». */}
        {me.kind === "adult" && me.teacherStatus === "none" && me.profile ? (
          <div className="settings__row">
            <ChalkboardTeacher weight="fill" aria-hidden />
            <Link href={nextTeacherStep(me)} className="settings__name settings__link">
              {t("Я учитель")}
            </Link>
          </div>
        ) : null}
        <div className="settings__row">
          <LinkButton tone="danger" icon={<SignOut weight="bold" aria-hidden />} onClick={() => setLeaving(true)}>
            {t("Выйти")}
          </LinkButton>
        </div>
      </Card>

      <GoalDialog open={goalOpen} me={me} onClose={() => setGoalOpen(false)} />

      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={noWayBack ? t("Сначала сделай карточку") : t("Уже уходишь?")}
        description={leaveText(t, me)}
        art={noWayBack ? illustrations.beeThink : illustrations.beeSympathy}
        centered
        hideClose
        actions={
          <>
            {noWayBack ? (
              <Button block onClick={() => router.push(paths.card)}>
                {t("Сделать карточку")}
              </Button>
            ) : (
              <Button block onClick={() => setLeaving(false)}>
                {t("Остаться")}
              </Button>
            )}
            <LinkButton
              tone="danger"
              onClick={async () => {
                // Ошибка сети не должна оставлять на /me: сессия уже разорвана локально, уводим на старт.
                await session.logout().catch(() => undefined);
                // Полная загрузка, а не router.replace: закрытие диалога убирает свою запись истории (history.back
                // в sheetHistory), и пришедший popstate отменяет клиентский переход — страница оставалась на /me со
                // скелетом. При выходе и так нужно снести всё состояние вкладки: токены в памяти, кеш экранов.
                window.location.replace(paths.start);
              }}
            >
              {t("Выйти")}
            </LinkButton>
          </>
        }
      />
    </>
  );
}

/** Чем войти снова — по тому, как ученик сюда попал (ADR 0022). */
function leaveText(t: T, me: Me): string {
  if (me.loginCard === "none" && !me.profile && !studentClass(me)) return t("Без неё мёд и серию не вернуть.");
  if (me.loginCard === "issued") return t("Войти снова можно по твоей карточке.");
  if (me.kind === "adult") return t("Войти снова можно по почте.");
  return t("Войти снова можно по карточке или коду класса.");
}

/** «Цель дня»: 1, 2 или 3 урока (PATCH /me dailyGoal, ADR 0022). */
function GoalDialog({ open, me, onClose }: { open: boolean; me: Me; onClose: () => void }) {
  const t = useT();
  const [goal, setGoal] = useState<Goal>(asGoal(me.dailyGoal));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setGoal(asGoal(me.dailyGoal));
  }, [open, me.dailyGoal]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Цель дня")}
      actions={
        <>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <Button
            block
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                session.updateAccount(await selfApi.updateMe({ dailyGoal: goal }));
                onClose();
              } catch (e) {
                setError(describeProblem(e, "child"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Сохранить")}
          </Button>
        </>
      }
    >
      <GoalPicker value={goal} onChange={setGoal} />
    </Dialog>
  );
}

/** Что ученик уже видел в «Моём вкладе» на этом устройстве: сколько вариантов созрело и сколько мёда за голоса. */
interface CellsSeen {
  matured: number;
  honey: number;
}

const seenKey = (accountId: string) => `teletau.cells-seen.${accountId}`;

function readSeen(accountId: string): CellsSeen | null {
  try {
    const raw = window.localStorage.getItem(seenKey(accountId));
    const v = raw ? (JSON.parse(raw) as Partial<CellsSeen>) : null;
    return v && typeof v.matured === "number" && typeof v.honey === "number" ? { matured: v.matured, honey: v.honey } : null;
  } catch {
    return null;
  }
}

function writeSeen(accountId: string, seen: CellsSeen) {
  try {
    window.localStorage.setItem(seenKey(accountId), JSON.stringify(seen));
  } catch {
    // Хранилище недоступно (приватный режим) — плашка просто не появится.
  }
}

/**
 * «Мёд созрел!» (scene-honey-matured): с прошлого захода в профиль созрели варианты, за которые голосовал ученик, —
 * мёд за голос из «ждёт» стал начисленным (docs/demo/M2.md, шаг 6). Что уже видено — счётчики в localStorage этого
 * устройства (только номер аккаунта и числа, без ПДн); первый заход ничего не показывает, а запоминает.
 */
function MaturedHoney({ accountId, cells }: { accountId: string; cells: MyCellsPage }) {
  const t = useT();
  const { matured, honeyFinal } = cells.summary;
  const [fresh, setFresh] = useState<{ count: number; honey: number } | null>(null);
  useEffect(() => {
    const seen = readSeen(accountId);
    if (seen && matured > seen.matured) setFresh({ count: matured - seen.matured, honey: Math.max(0, honeyFinal - seen.honey) });
    writeSeen(accountId, { matured, honey: honeyFinal });
  }, [accountId, matured, honeyFinal]);
  if (!fresh) return null;
  const { count, honey } = fresh;
  const plus = honey > 0 ? t(" · +{n} мёда", { n: honey }) : "";
  return (
    <section className="matured" role="status" aria-labelledby="matured-title">
      <Illustration name="sceneHoneyMatured" width={92} className="matured__art" />
      <div>
        <h2 className="matured__title" id="matured-title">
          {t("Мёд созрел!")}
        </h2>
        <p className="matured__text">
          {t("{count} {word} с твоим голосом {verb} в словарь{plus}", {
            count,
            word: plural(count, [t("перевод"), t("перевода"), t("переводов")]),
            verb: plural(count, [t("вошёл"), t("вошли"), t("вошли")]),
            plus,
          })}
        </p>
      </div>
    </section>
  );
}
