"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, SignOut } from "@phosphor-icons/react/ssr";
import { FOLD_MAP } from "@teletau/bashkir-text";
import { Button, ButtonLink, EmptyState, IconButton, LinkButton, Skeleton, SkeletonGroup, TopBar } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { ApiProblem, describeProblem, isGenericProblem, isNetworkError, type Audience } from "@teletau/session/problem";
import { useT } from "../../i18n/client";

/** Каркас экрана: верхняя панель + основная область (id="main" — цель ссылки «К основному содержимому»). */
export function Screen({
  top,
  children,
  wide,
  bottom,
  className,
}: {
  top?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  bottom?: ReactNode;
  className?: string;
}) {
  return (
    <div className="tt-page">
      {top}
      <main id="main" className={["tt-main", className].filter(Boolean).join(" ")}>
        <div className={["tt-column", wide && "tt-column--wide", "screen-body"].filter(Boolean).join(" ")}>{children}</div>
      </main>
      {bottom}
    </div>
  );
}

/** Кнопка «Назад» в верхней панели: на конкретный адрес (надёжнее истории при входе по ссылке из QR). */
export function BackLink({ href, label }: { href: string; label?: string }) {
  const t = useT();
  const text = label ?? t("Назад");
  return (
    <Link href={href} className="tt-icon-btn" aria-label={text} title={text}>
      <ArrowLeft weight="bold" />
    </Link>
  );
}

export function BackButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const t = useT();
  return <IconButton label={label ?? t("Назад")} icon={<ArrowLeft weight="bold" />} onClick={onClick} />;
}

export function SimpleTop({ back, start, title, end, wide }: { back?: string; start?: ReactNode; title?: ReactNode; end?: ReactNode; wide?: boolean }) {
  return <TopBar wide={wide} start={start ?? (back ? <BackLink href={back} /> : undefined)} title={title} end={end} />;
}

/**
 * «Выйти» в верхней панели — на экранах, где больше некуда уйти (условия, заявка, ожидание проверки): учитель на общем
 * компьютере в учительской должен суметь выйти, пока заявка ждёт модератора. onBeforeLogout — очистить черновики.
 */
export function SignOutAction({ onBeforeLogout, to = "/" }: { onBeforeLogout?: () => void; to?: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    onBeforeLogout?.();
    await session.logout();
    router.replace(to);
  };
  return (
    <LinkButton tone="neutral" icon={<SignOut weight="bold" aria-hidden />} disabled={busy} onClick={() => void signOut()}>
      {t("Выйти")}
    </LinkButton>
  );
}

/** Скелетон экрана: заголовок, текст и блоки — пока данные грузятся. */
export function LoadingBlock({ rows = 3, label }: { rows?: number; label?: string }) {
  const t = useT();
  return (
    <SkeletonGroup label={label ?? t("Загружаем")} className="tt-stack">
      <Skeleton width="60%" height={30} />
      <Skeleton width="85%" height={16} />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={72} radius="card" />
      ))}
    </SkeletonGroup>
  );
}

/**
 * Ошибка загрузки: офлайн — своя иллюстрация и текст, ошибка API — понятный текст из Problem Details.
 * Действие — повторить.
 */
export function LoadError({ error, onRetry, audience = "adult", home }: { error: unknown; onRetry: () => void; audience?: Audience; home?: string }) {
  const t = useT();
  const you = audience === "child";
  if (isNetworkError(error)) {
    return (
      <EmptyState
        art="emptyOffline"
        title={t("Нет связи")}
        actions={
          <Button block onClick={onRetry}>
            {t("Попробовать ещё раз")}
          </Button>
        }
      >
        {you ? t("Проверь интернет.") : t("Проверьте подключение к интернету. Как только сеть вернётся, всё загрузится.")}
      </EmptyState>
    );
  }
  return (
    <EmptyState
      art="emptyError"
      title={t("Что-то пошло не так")}
      role="alert"
      actions={
        <>
          <Button block onClick={onRetry}>
            {t("Попробовать ещё раз")}
          </Button>
          {home ? (
            <ButtonLink href={home} variant="secondary" block>
              {t("На главную")}
            </ButtonLink>
          ) : null}
        </>
      }
    >
      {isGenericProblem(error) ? null : describeProblem(error, audience, t)}
    </EmptyState>
  );
}

export function isForbidden(e: unknown): boolean {
  return e instanceof ApiProblem && e.status === 403;
}

export function isNotFound(e: unknown): boolean {
  return e instanceof ApiProblem && e.status === 404;
}

const TITLE_SUFFIX = " · ТелеТау";

/**
 * Заголовок вкладки для состояния экрана, которое не видно серверу (шаг сценария, название класса): «Выбери ник · ТелеТау».
 * Начальный заголовок маршрута задаёт metadata его layout.tsx. undefined — не менять.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const wanted = `${title}${TITLE_SUFFIX}`;
    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    // Next.js дописывает <title> из metadata потоком уже после гидратации — возвращаем заголовок шага поверх него.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}

/** Особые башкирские буквы (ҡ ғ ҙ ҫ һ ә ө ү ң) — из таблицы свёртки @teletau/bashkir-text, без русской ё. */
const BASHKIR_LETTERS = new Set([...FOLD_MAP.keys()].filter((cp) => cp !== 0x0451));

export function hasBashkirLetters(text: string): boolean {
  for (const ch of text.toLocaleLowerCase("ru")) if (BASHKIR_LETTERS.has(ch.codePointAt(0)!)) return true;
  return false;
}

/**
 * Название класса «7 «Ә»»: литера с башкирской буквой размечена lang="ba" (озвучка и шрифтовые формы), номер — нет.
 */
export function ClassTitle({ title }: { title: string }) {
  const m = /^(.*«)(.+)(»)$/.exec(title);
  if (!m) return hasBashkirLetters(title) ? <span lang="ba">{title}</span> : <>{title}</>;
  const [, before, letter, after] = m;
  return (
    <>
      {before}
      {hasBashkirLetters(letter!) ? <span lang="ba">{letter}</span> : letter}
      {after}
    </>
  );
}
