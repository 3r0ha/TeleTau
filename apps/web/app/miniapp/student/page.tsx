"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Keyboard, QrCode } from "@phosphor-icons/react/ssr";
import { Button, ButtonLink, Illustration, InlineAlert } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { useT } from "../../../i18n/client";
import { useStudentPaths } from "../../_components/learn/paths";
import { LoadingBlock, Screen, SimpleTop } from "../../_components/screens";
import { useTelegram } from "../../_components/telegram/TelegramProvider";
import StudentScanPage from "../../student/page";
import { useQrLogin } from "../../student/qr";

/**
 * Вход ученика в Mini App. Сначала — тихая проба входа по привязке чата (ADR 0020): initData есть и чат уже
 * связан с аккаунтом — заходим без карточки. Не связан (404) или initData нет — обычный вход: в мобильном
 * Telegram сканер QR самого Telegram (web_app_open_scan_qr_popup), текст QR приходит событием qr_text_received
 * и уходит тем же путём, что в вебе, — проверка @teletau/auth-codes, затем BFF /api/session/qr. В Telegram Web,
 * Desktop и обычном браузере — веб-сканер (камера или фото карточки).
 */
export default function MiniAppStudentLogin() {
  const tg = useTelegram();
  const t = useT();
  const probe = useTelegramLogin(tg.bridge);
  if (!tg.checked || probe === "checking")
    return (
      <Screen top={<SimpleTop title={t("Вход ученика")} />}>
        <LoadingBlock rows={2} label={probe === "checking" ? t("Входим по Telegram") : t("Открываем вход")} />
      </Screen>
    );
  return tg.canScanQr ? <TelegramScanLogin /> : <StudentScanPage withSelf />;
}

/**
 * Проба входа по привязке (ADR 0020): initData читается не расходуя (peek) — не связанный чат оставит её для
 * привязки после входа карточкой (LinkChat в TelegramProvider). Ошибка любой причины не показывается: экран
 * просто переходит к обычному входу. Однократность — ссылкой на промис (StrictMode, повторные рендеры).
 */
function useTelegramLogin(bridge: ReturnType<typeof useTelegram>["bridge"]): "checking" | "skip" {
  const router = useRouter();
  const paths = useStudentPaths();
  const [status, setStatus] = useState<"checking" | "skip">("skip");
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !bridge?.inTelegram) return;
    const initData = bridge.peekInitData();
    if (!initData) return;
    started.current = true;
    setStatus("checking");
    session
      .loginWithTelegram(initData)
      .then((me) => {
        // Вход по привязке уже связал чат: initData больше не нужен.
        bridge.takeInitData();
        router.replace(me.nickname ? paths.learn : paths.nickname);
      })
      .catch(() => setStatus("skip"));
  }, [bridge, router, paths]);

  return status;
}

function TelegramScanLogin() {
  const { bridge } = useTelegram();
  const paths = useStudentPaths();
  const t = useT();
  const { state, login, reset } = useQrLogin();
  const busy = state.status === "pending";

  useEffect(() => {
    if (!bridge) return;
    const offText = bridge.on("qr_text_received", ({ data }) => {
      bridge.closeScanQr();
      void login(data);
    });
    return () => {
      offText();
      bridge.closeScanQr();
    };
  }, [bridge, login]);

  const scan = () => {
    reset();
    bridge?.openScanQr(t("Наведи на QR-код карточки"));
  };

  return (
    <Screen top={<SimpleTop title={t("Вход ученика")} />}>
      <div className="tt-stack tt-stack--loose tg-login">
        <Illustration name="beeExplain" width={176} className="tg-login__art" />
        <h1 className="tt-title2 tg-login__head">{t("Покажи карточку камере")}</h1>
        <div className="tt-stack tt-stack--tight">
          <Button block icon={<QrCode weight="bold" />} loading={busy} onClick={scan}>
            {busy ? t("Входим…") : t("Сканировать карточку")}
          </Button>
          <div aria-live="polite" className="tt-stack tt-stack--tight">
            {busy ? <p className="tt-visually-hidden">{t("Карточка найдена, входим")}</p> : null}
            {state.status === "error" ? <InlineAlert tone="danger">{state.message}</InlineAlert> : null}
          </div>
        </div>
        <ButtonLink href={paths.code} variant="secondary" block icon={<Keyboard weight="fill" />}>
          {t("Ввести код класса")}
        </ButtonLink>
        {/* «Учусь сам» (ADR 0022): в Mini App тоже можно без карточки и класса — сразу возраст и ник. */}
        <ButtonLink href={paths.self} variant="secondary" block icon={<BookOpen weight="fill" />}>
          {t("Учусь сам")}
        </ButtonLink>
      </div>
    </Screen>
  );
}
