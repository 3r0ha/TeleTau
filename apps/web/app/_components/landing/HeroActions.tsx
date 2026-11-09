"use client";

import { useEffect } from "react";
import { Button, ButtonLink, HexAvatar, avatarFor, toneFor } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { useSession } from "@teletau/session/react";
import type { Me } from "@teletau/session/types";
import { homeOf } from "../home";

/** Вход на этом устройстве уже открыт: аккаунт и куда его вернуть. Без сессии (и на сервере) — null. */
function useResume(): { me: Me; home: string } | null {
  const state = useSession();
  useEffect(() => {
    void session.restore();
  }, []);
  if (state.status !== "authenticated") return null;
  const home = homeOf(state.account);
  return home ? { me: state.account, home } : null;
}

/**
 * Кнопки героя: «Начать» («Учусь сам») и «У меня есть карточка или код». Если на устройстве уже есть вход —
 * «Продолжить» и «Это не я»: школьный планшет общий, поэтому без автоматического перехода в чужой аккаунт.
 */
export function HeroActions() {
  const resume = useResume();
  if (resume) {
    const { me, home } = resume;
    return (
      <div className="lp-hero__actions">
        {me.nickname ? (
          <p className="lp-hero__who">
            <HexAvatar size={40} tone={toneFor(me.nickname)} art={avatarFor(me.nickname)} />
            {me.nickname}
          </p>
        ) : null}
        <ButtonLink href={home} block>
          Продолжить
        </ButtonLink>
        <Button variant="secondary" block onClick={() => void session.logout()}>
          Это не я
        </Button>
      </div>
    );
  }
  return (
    <div className="lp-hero__actions">
      <ButtonLink href="/self" block>
        Начать
      </ButtonLink>
      <ButtonLink href="/student" variant="secondary" block>
        У меня есть карточка или код
      </ButtonLink>
    </div>
  );
}

/** Кнопка финального призыва: «Начать», а при открытом входе — «Продолжить». */
export function StartButton() {
  const resume = useResume();
  return resume ? (
    <ButtonLink href={resume.home} className="lp-final__btn">
      Продолжить
    </ButtonLink>
  ) : (
    <ButtonLink href="/self" className="lp-final__btn">
      Начать
    </ButtonLink>
  );
}
