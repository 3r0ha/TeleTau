"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { ArrowsClockwise, DownloadSimple, IdentificationCard } from "@phosphor-icons/react/ssr";
import tokens from "@teletau/design-tokens/tokens.json";
import { Button, Card, Dialog, EmptyState, HexAvatar, InlineAlert, LinkButton, avatarFor, illustrations, toneFor } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import type { Schema } from "@teletau/contracts";
import { isNotFound, LoadError, LoadingBlock, Screen, SimpleTop } from "../screens";
import { useStudentPaths } from "./paths";
import { selfApi } from "./self-api";
import { useStudent } from "./StudentShell";

type LoginCard = Schema<"LoginCard">;

/** Тихая зона вокруг QR — 4 модуля (ISO/IEC 18004). */
const QUIET = 4;

function qrModules(text: string) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  return { size: modules.size, dark: (x: number, y: number) => Boolean(modules.get(y, x)) };
}

/** Тёмные модули строкой SVG-пути (как SiteQr): подряд идущие модули строки — один прямоугольник. */
function qrPath(text: string): { size: number; d: string } {
  const { size, dark } = qrModules(text);
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; ) {
      if (!dark(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && dark(x, y)) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  return { size, d };
}

/**
 * QR личной карточки: в коде — только полезная нагрузка `TP1.…`, без ссылки (ADR 0016 §2, ADR 0022): системная камера
 * не откроет браузер с секретом. Цвета — классами из токенов, одинаково в обеих темах (камеры не читают «негатив»).
 */
function CardQr({ payload }: { payload: string }) {
  const { size, d } = useMemo(() => qrPath(payload), [payload]);
  const box = size + QUIET * 2;
  return (
    <svg className="site-qr login-card__qr" viewBox={`${-QUIET} ${-QUIET} ${box} ${box}`} role="img" aria-label="QR-код карточки входа" shapeRendering="crispEdges">
      <rect className="site-qr__bg" x={-QUIET} y={-QUIET} width={box} height={box} />
      <path className="site-qr__dark" d={d} />
    </svg>
  );
}

const { light, base } = tokens as { light: Record<string, string>; base: Record<string, string> };
/** Семейство шрифта из токенов в кавычках — для холста (`ctx.font`). */
const family = (key: "fontFamily.display" | "fontFamily.text") => `"${base[key] ?? "sans-serif"}"`;

/**
 * Картинка карточки для сохранения (PNG, 1080 × 1350): название, ник, QR и шаги входа. Цвета — светлая тема токенов
 * (печать и фото экрана), шрифты — те же, что у интерфейса (ждём их загрузки, иначе холст возьмёт системный).
 */
async function cardPng(card: LoginCard, nickname: string): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const display = family("fontFamily.display");
  const text = family("fontFamily.text");
  await Promise.all([document.fonts.load(`900 80px ${display}`), document.fonts.load(`600 36px ${text}`)]).catch(() => undefined);

  ctx.fillStyle = light["color.bgSunken"]!;
  ctx.fillRect(0, 0, W, H);
  // Карточка с «губой» — как плитки интерфейса.
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  ctx.fillStyle = light["color.accent.lip"]!;
  round(60, 76, W - 120, H - 136, 56);
  ctx.fill();
  ctx.fillStyle = light["color.surface"]!;
  round(60, 60, W - 120, H - 136, 56);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = light["color.text.primary"]!;
  ctx.font = `900 84px ${display}`;
  // «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1)
  ctx.fillText("ТелеТау", W / 2, 190);
  ctx.fillStyle = light["color.text.secondary"]!;
  ctx.font = `600 38px ${text}`;
  ctx.fillText("Карточка входа", W / 2, 250);
  ctx.fillStyle = light["color.text.primary"]!;
  ctx.font = `900 52px ${display}`;
  ctx.fillText(nickname, W / 2, 330);

  const { size, dark } = qrModules(card.payload);
  const side = 600;
  const cell = side / (size + QUIET * 2);
  const qx = (W - side) / 2;
  const qy = 380;
  ctx.fillStyle = light["color.highlight"]!;
  ctx.fillRect(qx, qy, side, side);
  ctx.fillStyle = light["color.text.onFill"]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (dark(x, y)) ctx.fillRect(qx + (x + QUIET) * cell, qy + (y + QUIET) * cell, Math.ceil(cell), Math.ceil(cell));

  ctx.fillStyle = light["color.text.secondary"]!;
  ctx.font = `600 34px ${text}`;
  const steps = [`1. Открой ${window.location.host}`, "2. Нажми «У меня есть карточка или код»", "3. «Сканировать карточку» и наведи на этот код"];
  steps.forEach((line, i) => ctx.fillText(line, W / 2, 1065 + i * 52));
  ctx.font = `600 28px ${text}`;
  ctx.fillText(`Выпуск ${card.version} · не показывай карточку чужим`, W / 2, 1230);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
}

async function download(card: LoginCard, nickname: string) {
  const blob = await cardPng(card, nickname);
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `teletau-karta-${card.version}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * «Моя карточка входа» (ADR 0022): самостоятельный ученик входит в свой аккаунт на другом устройстве по QR — тем же
 * сканером, что и ученик класса («У меня есть карточка или код» → «Сканировать карточку»). Показать, сохранить картинкой, сделать новую
 * (старая перестаёт работать, вход на других устройствах закрывается).
 */
export function LoginCardScreen() {
  const me = useStudent();
  const paths = useStudentPaths();
  const allowed = Boolean(me?.loginCard);
  const card = useResource(() => selfApi.loginCard(), [me?.id], { enabled: allowed });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const issue = async () => {
    setBusy(true);
    setError(null);
    setConfirm(false);
    try {
      const fresh = await selfApi.issueLoginCard();
      card.setData(() => fresh);
      if (me && me.loginCard !== "issued") session.updateAccount({ ...me, loginCard: "issued" });
    } catch (e) {
      setError(describeProblem(e, "child"));
    } finally {
      setBusy(false);
    }
  };

  const none = card.error && isNotFound(card.error);

  return (
    <Screen top={<SimpleTop back={paths.me} title="Карточка входа" />} className="login-card">
      {!me ? (
        <LoadingBlock rows={2} />
      ) : !allowed ? (
        <EmptyState
          art="beeIdle"
          title="Карточка не нужна"
          actions={
            <LinkButton tone="neutral" onClick={() => history.back()}>
              Назад
            </LinkButton>
          }
        >
          {me.kind === "adult" ? "Ты входишь по почте." : "Ты входишь по карточке от учителя."}
        </EmptyState>
      ) : card.data ? (
        <div className="tt-stack tt-stack--loose">
          <header className="tt-stack tt-stack--tight">
            <h1 className="tt-title2">Моя карточка входа</h1>
            <p className="tt-lead">На другом устройстве: «У меня есть карточка или код» → «Сканировать карточку».</p>
          </header>
          <Card className="login-card__card">
            <div className="login-card__who">
              <HexAvatar size={44} tone={toneFor(me.nickname ?? me.id)} art={avatarFor(me.nickname)} lip />
              <p className="tt-headline">{me.nickname}</p>
            </div>
            <CardQr payload={card.data.payload} />
            <p className="login-card__meta">Выпуск {card.data.version}</p>
          </Card>
          <p className="login-card__warn">
            <IdentificationCard weight="fill" aria-hidden />
            Не показывай карточку чужим.
          </p>
          <div aria-live="polite">{error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}</div>
          <div className="tt-stack tt-stack--tight">
            <Button
              block
              icon={<DownloadSimple weight="bold" />}
              loading={saving}
              onClick={async () => {
                setSaving(true);
                await download(card.data!, me.nickname ?? "").catch(() => setError("Не получилось сохранить картинку. Сделай снимок экрана."));
                setSaving(false);
              }}
            >
              Сохранить картинку
            </Button>
            <LinkButton tone="neutral" icon={<ArrowsClockwise weight="bold" aria-hidden />} disabled={busy} onClick={() => setConfirm(true)}>
              Сделать новую карточку
            </LinkButton>
          </div>
          <Dialog
            open={confirm}
            onClose={() => setConfirm(false)}
            title="Сделать новую карточку?"
            description="Старая перестанет работать."
            art={illustrations.beeThink}
            centered
            hideClose
            actions={
              <>
                <Button block loading={busy} onClick={() => void issue()}>
                  Сделать новую
                </Button>
                <LinkButton tone="neutral" onClick={() => setConfirm(false)}>
                  Отмена
                </LinkButton>
              </>
            }
          />
        </div>
      ) : none ? (
        <EmptyState
          art="beeRead"
          title="Сделай карточку входа"
          actions={
            <>
              <Button block loading={busy} onClick={() => void issue()}>
                Сделать карточку
              </Button>
              {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            </>
          }
        >
          С ней войдёшь с любого устройства, мёд и серия сохранятся.
        </EmptyState>
      ) : card.error ? (
        <LoadError error={card.error} onRetry={card.reload} audience="child" />
      ) : (
        <LoadingBlock rows={2} label="Загружаем карточку" />
      )}
    </Screen>
  );
}
