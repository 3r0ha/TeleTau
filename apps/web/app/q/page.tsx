"use client";

import { useEffect } from "react";
import { Keyboard, QrCode } from "@phosphor-icons/react/ssr";
import { ButtonLink, EmptyState } from "@teletau/ui";
import { Screen, SimpleTop } from "../_components/screens";

/**
 * Старый адрес карточки `/q#TT1.…` (ADR 0016). Секрет из адреса страница НЕ принимает: ссылка с
 * секретом остаётся в истории браузера, и на общем планшете по ней мог бы войти следующий ученик. В QR —
 * только полезная нагрузка `TT1.…`, её читает сканер «У меня есть карточка или код» → «Сканировать карточку». Здесь — как туда попасть.
 * Везде одно слово — «сайт», как на карточке («Открой сайт …»).
 * Фрагмент всё же стираем из адресной строки, чтобы его не увидели через плечо.
 */
export default function QrLandingPage() {
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);

  return (
    <Screen top={<SimpleTop back="/" title="Вход по карточке" />}>
      <EmptyState
        art="beeExplain"
        title="Карточку сканируют на сайте"
        actions={
          <>
            <ButtonLink href="/student" block icon={<QrCode weight="bold" />}>
              Сканировать карточку
            </ButtonLink>
            <ButtonLink href="/student/code" block variant="secondary" icon={<Keyboard weight="fill" />}>
              Войти по коду класса
            </ButtonLink>
          </>
        }
      />
    </Screen>
  );
}
