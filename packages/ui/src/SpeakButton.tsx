"use client";

import { useEffect, useRef, useState } from "react";
import { SpeakerHigh } from "@phosphor-icons/react/ssr";
import { useUiStrings } from "./UiStrings";

/** Файл записи и его тип (MIME с кодеком) — для выбора того, что браузер умеет играть. */
export interface AudioSource {
  src: string;
  type: string;
}

export interface SpeakButtonProps {
  /**
   * Запись произношения носителем — файлы с сайта по порядку предпочтения (оригинал Ogg, затем AAC для Safari и iOS).
   * Играет первый, который браузер умеет (canPlayType). Без записей кнопки нет вовсе.
   */
  sources: readonly AudioSource[];
  /** Подпись для читалки: «Послушать» или «Послушать: <слово>». */
  label?: string;
  /** small — в строке словаря и в листе ответа; по умолчанию — крупная, как в карточке слова. */
  size?: "large" | "small";
  className?: string;
}

/** Первый файл, который браузер берётся сыграть; не знает ни одного — последний (AAC играют почти все). */
function pick(sources: readonly AudioSource[]): string | undefined {
  if (sources.length === 0) return undefined;
  const probe = typeof document === "undefined" ? null : document.createElement("audio");
  return (probe ? sources.find((s) => probe.canPlayType(s.type) !== "") : undefined)?.src ?? sources[sources.length - 1]!.src;
}

/** Запись носителя играет или замолчала: звуки интерфейса (apps/web learn/sound.ts) на это время молчат. */
function speech(playing: boolean) {
  window.dispatchEvent(new CustomEvent("tt-speech", { detail: playing }));
}

/**
 * «Послушать» (prototype .speak): медовая кнопка со значком динамика. Запись грузится только по нажатию; пока играет,
 * значок «звучит». Не загрузилась — кнопка просто перестаёт звучать (ребёнку не показываем технических ошибок).
 */
export function SpeakButton({ sources, label, size = "large", className }: SpeakButtonProps) {
  const s = useUiStrings();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const key = sources.map((s) => s.src).join(" ");

  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [key],
  );

  if (sources.length === 0) return null;

  const play = () => {
    let a = audio.current;
    if (!a) {
      const src = pick(sources);
      if (!src) return;
      a = new Audio(src);
      a.preload = "auto";
      const stop = () => {
        setPlaying(false);
        speech(false);
      };
      a.addEventListener("ended", stop);
      a.addEventListener("pause", stop);
      a.addEventListener("error", stop);
      audio.current = a;
    }
    a.currentTime = 0;
    setPlaying(true);
    speech(true);
    a.play().catch(() => {
      setPlaying(false);
      speech(false);
    });
  };

  return (
    <button
      type="button"
      className={["tt-speak", size === "small" && "tt-speak--small", className].filter(Boolean).join(" ")}
      aria-label={label ?? s.speak}
      data-playing={playing || undefined}
      onClick={play}
    >
      <SpeakerHigh weight="fill" aria-hidden />
    </button>
  );
}
