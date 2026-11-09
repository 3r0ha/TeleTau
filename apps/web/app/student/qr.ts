"use client";

// Распознавание QR-карточки: камера через BarcodeDetector (Chrome, Android, Safari 17+), запасной вариант — jsQR
// по кадру видео или по загруженному фото. Разбор и проверка — только @teletau/auth-codes (ADR 0016). Сканер один для
// карточки места класса (TT1) и личной карточки самостоятельного ученика (TP1, ADR 0022): вид — по префиксу.
import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { parseLoginCard } from "@teletau/auth-codes";
import { session } from "@teletau/session/client";
import { ApiProblem, describeProblem } from "@teletau/session/problem";
import { useStudentPaths } from "../_components/learn/paths";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | ImageBitmap): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

let detectorPromise: Promise<BarcodeDetectorLike | null> | null = null;

/**
 * Нативный детектор бывает, но не отвечает: detect() не завершается (так в headless Chromium на macOS 26). Ждём его
 * не дольше NATIVE_TIMEOUT_MS; не ответил — больше им не пользуемся, распознаёт jsQR.
 */
const NATIVE_TIMEOUT_MS = 1500;

async function detectNative(native: BarcodeDetectorLike, source: CanvasImageSource | ImageBitmap): Promise<DetectedBarcode[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), NATIVE_TIMEOUT_MS);
  });
  const found = await Promise.race([native.detect(source).catch(() => [] as DetectedBarcode[]), timeout]);
  clearTimeout(timer);
  if (found === null) detectorPromise = Promise.resolve(null);
  return found;
}

/** Нативный детектор QR, если браузер его поддерживает. */
export function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!Ctor) return null;
      try {
        const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
        return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
      } catch {
        return null;
      }
    })();
  }
  return detectorPromise;
}

/** jsQR по изображению, уменьшенному до maxSide (быстрее и надёжнее на больших фото). */
function decodeWithJsQr(source: CanvasImageSource, width: number, height: number, maxSide: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return jsQR(data, w, h, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** Один кадр видео → текст QR или null. */
export async function decodeVideoFrame(video: HTMLVideoElement): Promise<string | null> {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const native = await nativeDetector();
  if (native) {
    const found = await detectNative(native, video);
    if (found) return found[0]?.rawValue ?? null;
  }
  return decodeWithJsQr(video, video.videoWidth, video.videoHeight, 720);
}

/** Фото карточки → текст QR или null. Пробуем несколько масштабов: QR на фото бывает мелким. */
export async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const native = await nativeDetector();
    if (native) {
      const found = await detectNative(native, bitmap);
      if (found?.[0]) return found[0].rawValue;
    }
    for (const side of [1600, 1000, 2400]) {
      const text = decodeWithJsQr(bitmap, bitmap.width, bitmap.height, side);
      if (text) return text;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** Отказы по личной карточке — без «покажи учителю»: её делает сам ученик в профиле (ADR 0022). */
const PERSONAL_CARD_ERRORS: Record<string, string> = {
  card_invalid: "Карточка не найдена. Сделай новую в профиле на устройстве, где ты уже вошёл.",
  card_revoked: "Эта карточка больше не действует: ты сделал новую. Покажи её.",
};

export type QrLoginState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string };

/**
 * Вход по тексту из QR: проверка полезной нагрузки до отправки (контракт: клиент проверяет её сам),
 * затем BFF → POST /auth/qr. Первый вход — выбор ника, повторный — сразу на тропу.
 */
export function useQrLogin() {
  const router = useRouter();
  const paths = useStudentPaths();
  const [state, setState] = useState<QrLoginState>({ status: "idle" });
  const login = useCallback(
    async (raw: string): Promise<boolean> => {
      const parsed = parseLoginCard(raw);
      if (!parsed.ok) {
        setState({ status: "error", message: "Это не карточка ученика. Попробуй ещё раз." });
        return false;
      }
      setState({ status: "pending" });
      try {
        if (parsed.kind === "personal") {
          // Личная карточка «Учусь сам»: аккаунт уже с ником — сразу на тропу.
          await session.loginWithCard(parsed.payload);
          router.replace(paths.learn);
          return true;
        }
        const me = await session.loginWithQr(parsed.payload);
        // Повторный вход — сразу на тропу; первый — выбор ника, затем «Ты в классе».
        router.replace(me.nickname ? paths.learn : paths.nickname);
        return true;
      } catch (e) {
        const personal = parsed.kind === "personal" && e instanceof ApiProblem ? PERSONAL_CARD_ERRORS[e.code ?? ""] : undefined;
        setState({ status: "error", message: personal ?? describeProblem(e, "child") });
        return false;
      }
    },
    [router, paths],
  );
  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, login, reset };
}
