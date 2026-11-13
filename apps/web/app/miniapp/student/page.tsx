"use client";

import { useEffect } from "react";
import { BookOpen, Keyboard, QrCode } from "@phosphor-icons/react/ssr";
import { Button, ButtonLink, Illustration, InlineAlert } from "@teletau/ui";
import { useStudentPaths } from "../../_components/learn/paths";
import { LoadingBlock, Screen, SimpleTop } from "../../_components/screens";
import { useTelegram } from "../../_components/telegram/TelegramProvider";
import StudentScanPage from "../../student/page";
import { useQrLogin } from "../../student/qr";

/**
 * Вход ученика в Mini App. В мобильном Telegram — сканер QR самого Telegram (web_app_open_scan_qr_popup): текст QR
 * приходит событием qr_text_received и уходит тем же путём, что в вебе, — проверка @teletau/auth-codes, затем BFF
 * /api/session/qr. В Telegram Web, Desktop и обычном браузере — веб-сканер (камера или фото карточки).
 */
export default function MiniAppStudentLogin() {
  const tg = useTelegram();
  if (!tg.checked)
    return (
      <Screen top={<SimpleTop title="Вход ученика" />}>
        <LoadingBlock rows={2} label="Открываем вход" />
      </Screen>
    );
  return tg.canScanQr ? <TelegramScanLogin /> : <StudentScanPage withSelf />;
}

function TelegramScanLogin() {
  const { bridge } = useTelegram();
  const paths = useStudentPaths();
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
    bridge?.openScanQr("Наведи на QR-код карточки");
  };

  return (
    <Screen top={<SimpleTop title="Вход ученика" />}>
      <div className="tt-stack tt-stack--loose tg-login">
        <Illustration name="beeExplain" width={176} className="tg-login__art" />
        <h1 className="tt-title2 tg-login__head">Покажи карточку камере</h1>
        <div className="tt-stack tt-stack--tight">
          <Button block icon={<QrCode weight="bold" />} loading={busy} onClick={scan}>
            {busy ? "Входим…" : "Сканировать карточку"}
          </Button>
          <div aria-live="polite" className="tt-stack tt-stack--tight">
            {busy ? <p className="tt-visually-hidden">Карточка найдена, входим</p> : null}
            {state.status === "error" ? <InlineAlert tone="danger">{state.message}</InlineAlert> : null}
          </div>
        </div>
        <ButtonLink href={paths.code} variant="secondary" block icon={<Keyboard weight="fill" />}>
          Ввести код класса
        </ButtonLink>
        {/* «Учусь сам» (ADR 0022): в Mini App тоже можно без карточки и класса — сразу возраст и ник. */}
        <ButtonLink href={paths.self} variant="secondary" block icon={<BookOpen weight="fill" />}>
          Учусь сам
        </ButtonLink>
      </div>
    </Screen>
  );
}
