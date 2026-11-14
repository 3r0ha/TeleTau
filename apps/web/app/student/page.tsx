"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Camera, CameraSlash, EnvelopeSimple, ImageSquare, Keyboard, QrCode } from "@phosphor-icons/react/ssr";
import { Button, ButtonLink, InlineAlert, LinkButton } from "@teletau/ui";
import { ApiProblem, describeProblem } from "@teletau/session/problem";
import { useSession } from "@teletau/session/react";
import { useT } from "../../i18n/client";
import type { T } from "../../i18n/core";
import { Screen, SimpleTop } from "../_components/screens";
import { decodeImageFile, decodeVideoFrame, useQrLogin } from "./qr";
import { useStudentPaths } from "../_components/learn/paths";

type CameraState = { status: "off" } | { status: "starting" } | { status: "on" } | { status: "error"; message: string };

const SCAN_INTERVAL_MS = 250;

function cameraError(t: T, e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return t("Нет доступа к камере. Разреши его в браузере или загрузи фото карточки.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("Камера не найдена. Загрузи фото карточки.");
  if (name === "NotReadableError") return t("Камера занята. Закрой другое приложение и попробуй снова.");
  return t("Камера не включилась. Загрузи фото карточки.");
}

/**
 * Вход ученика: сканер QR-карточки (камера или фото) и путь без карточки — по коду класса. В QR — только полезная
 * нагрузка `TT1.…` (ADR 0016): она не попадает ни в адрес, ни в историю браузера, а уходит в теле запроса к BFF.
 * `withSelf` — кнопка «Учусь сам» (ADR 0022): в Mini App вход без карточки и класса нужен, в обычном вебе он
 * уже есть кнопкой «Начать» в герое лендинга.
 */
export default function StudentScanPage({ withSelf = false }: { withSelf?: boolean } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>({ status: "off" });
  const [photoError, setPhotoError] = useState<string | null>(null);
  const { state, login, reset } = useQrLogin();
  const paths = useStudentPaths();
  const sessionState = useSession();
  const t = useT();
  // Сессию завершил сервер (перевыпуск карточки — 401 session_revoked, контракт reissueSeatCard): объясняем, что делать.
  const ended = sessionState.status === "anonymous" && (sessionState.reason === "session_revoked" || sessionState.reason === "card_reissued") ? sessionState.reason : null;

  const stop = useCallback(() => {
    clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stop, [stop]);

  const scanLoop = useCallback(() => {
    const tick = async () => {
      const video = videoRef.current;
      if (!video || !streamRef.current) return;
      const text = await decodeVideoFrame(video).catch(() => null);
      if (text) {
        stop();
        setCamera({ status: "off" });
        await login(text);
        return;
      }
      timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
    };
    void tick();
  }, [login, stop]);

  const start = async () => {
    reset();
    setPhotoError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera({ status: "error", message: t("В этом браузере нет камеры. Загрузи фото карточки.") });
      return;
    }
    setCamera({ status: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCamera({ status: "on" });
      scanLoop();
    } catch (e) {
      stop();
      setCamera({ status: "error", message: cameraError(t, e) });
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setPhotoError(null);
    stop();
    setCamera({ status: "off" });
    const text = await decodeImageFile(file).catch(() => null);
    if (fileRef.current) fileRef.current.value = "";
    if (!text) {
      setPhotoError(t("QR-код не виден. Сфотографируй карточку ближе и ровнее."));
      return;
    }
    await login(text);
  };

  const turnOff = () => {
    stop();
    setCamera({ status: "off" });
  };

  const busy = state.status === "pending";
  const live = camera.status === "on" || camera.status === "starting";

  return (
    <Screen top={<SimpleTop back={paths.start} title={t("Вход ученика")} />}>
      <div className="tt-stack tt-stack--loose scan">
        <h1 className="tt-title2">{t("Покажи карточку камере")}</h1>

        <div className="scan__frame" data-live={live}>
          <video ref={videoRef} className="scan__video" playsInline muted aria-label={t("Изображение с камеры")} hidden={!live} />
          {live ? (
            <span className="scan__corners" aria-hidden />
          ) : (
            <div className="scan__idle">
              <QrCode weight="duotone" aria-hidden className="scan__qr" />
              <Button onClick={start} icon={<Camera weight="fill" />} loading={busy}>
                {busy ? t("Входим…") : t("Сканировать карточку")}
              </Button>
            </div>
          )}
        </div>
        {live ? (
          <div className="scan__live-actions">
            {camera.status === "on" ? <p className="scan__hint">{t("Держи карточку ровно")}</p> : null}
            <LinkButton tone="neutral" icon={<CameraSlash weight="bold" aria-hidden />} onClick={turnOff}>
              {t("Выключить камеру")}
            </LinkButton>
          </div>
        ) : null}

        <div aria-live="polite" className="tt-stack tt-stack--tight">
          {ended && state.status === "idle" ? <InlineAlert tone="honey">{describeProblem(new ApiProblem(401, { code: ended }), "child")}</InlineAlert> : null}
          {busy ? <p className="tt-visually-hidden">{t("Карточка найдена, входим")}</p> : null}
          {state.status === "error" ? <InlineAlert tone="danger">{state.message}</InlineAlert> : null}
          {camera.status === "error" ? <InlineAlert tone="danger">{camera.message}</InlineAlert> : null}
          {photoError ? <InlineAlert tone="danger">{photoError}</InlineAlert> : null}
        </div>

        <div className="tt-stack tt-stack--tight">
          <input
            ref={fileRef}
            id="card-photo"
            type="file"
            aria-label={t("Фото карточки")}
            accept="image/*"
            capture="environment"
            className="tt-visually-hidden"
            tabIndex={-1}
            onChange={(e) => void onPhoto(e.target.files?.[0])}
          />
          <Button variant="secondary" block icon={<ImageSquare weight="fill" />} onClick={() => fileRef.current?.click()} disabled={busy}>
            {t("Загрузить фото")}
          </Button>
          <ButtonLink href={paths.code} variant="secondary" block icon={<Keyboard weight="fill" />}>
            {t("Ввести код класса")}
          </ButtonLink>
          {withSelf ? (
            <>
              <ButtonLink href={paths.self} variant="secondary" block icon={<BookOpen weight="fill" />}>
                {t("Учусь сам")}
              </ButtonLink>
              {/* Mini App: почтовый вход взрослого — сессия в рамке связывает чат с ботом (ADR 0020). */}
              <ButtonLink href={paths.loginEmail} variant="secondary" block icon={<EnvelopeSimple weight="fill" />}>
                {t("Войти по почте")}
              </ButtonLink>
            </>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}
