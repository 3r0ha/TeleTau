"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { ArrowsIn, ArrowsOut } from "@phosphor-icons/react/ssr";
import { IconButton } from "@teletau/ui";

/** Сколько миллисекунд без движения мыши номер, кнопка и курсор остаются на экране. */
const IDLE_MS = 2000;
/** Минимальный сдвиг пальца по горизонтали, который считается свайпом. */
const SWIPE_PX = 40;
/** Клик, который браузер может прислать следом за свайпом, не листает. */
const AFTER_SWIPE_MS = 400;
/** Сколько слайдов держать загруженными вокруг текущего: назад и вперёд. */
const BEHIND = 1;
const AHEAD = 2;
/** Размер файлов слайдов (16:9): браузер резервирует место до загрузки. */
const SLIDE = { width: 3840, height: 2160 };

const slideSrc = (n: number) => `/pitch/slide-${String(n).padStart(2, "0")}.webp`;

// Номер слайда живёт в hash (/pitch#5) и переживает перезагрузку. Смена слайда — replaceState: история браузера
// не копит по записи на слайд. replaceState не шлёт hashchange, поэтому подписчиков будит своё событие.
const HASH_EVENT = "tt-pitch-hash";

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}

/** Номер из hash; без номера — первый слайд. */
function hashSlide(): number {
  const n = Number.parseInt(window.location.hash.slice(1), 10);
  return Number.isFinite(n) ? n : 1;
}

function writeHash(n: number): void {
  window.history.replaceState(window.history.state, "", `#${n}`);
  window.dispatchEvent(new Event(HASH_EVENT));
}

function subscribeFullscreen(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

const isFullscreen = () => document.fullscreenElement !== null;
const fullscreenEnabled = () => document.fullscreenEnabled === true;
const noSubscribe = () => () => undefined;

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

/**
 * Слайды на весь экран: клавиши, клик по краям, свайп, полноэкранный режим. Слайд вписан в окно целиком,
 * переключение без анимации; соседние слайды загружены и раскодированы заранее.
 */
export function PitchDeck({ count }: { count: number }) {
  // На сервере hash не виден: до гидратации слайда нет (0), иначе после перезагрузки мелькал бы первый.
  const raw = useSyncExternalStore(subscribeHash, hashSlide, () => 0);
  const current = raw === 0 ? 0 : Math.min(Math.max(raw, 1), count);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
  const canFullscreen = useSyncExternalStore(noSubscribe, fullscreenEnabled, () => false);

  const go = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(n, 1), count);
      if (target !== hashSlide()) writeHash(target);
    },
    [count],
  );

  // Слайды светлые, и поля вокруг них должны сливаться со слайдом: при тёмной теме сайта страница слайдов светлая.
  // Выбор темы (cookie) не меняется; уход со страницы возвращает тему.
  useEffect(() => {
    const root = document.documentElement;
    const theme = root.getAttribute("data-theme");
    if (theme === null) return;
    root.removeAttribute("data-theme");
    return () => root.setAttribute("data-theme", theme);
  }, []);

  // Номер вне диапазона (#99) — в адрес попадает тот, что на экране.
  useEffect(() => {
    if (raw !== 0 && raw !== current) writeHash(current);
  }, [raw, current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (current === 0 || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // Enter и пробел на кнопке или ссылке нажимают её, а не листают.
      const onControl = e.target instanceof Element && e.target.closest("a, button") !== null;
      if ((e.key === "Enter" || e.key === " ") && onControl) return;
      if (e.code === "KeyF") {
        e.preventDefault();
        if (!e.repeat) toggleFullscreen();
        return;
      }
      let target: number | null = null;
      if (e.key === " " && e.shiftKey) target = current - 1;
      else if (NEXT_KEYS.has(e.key)) target = current + 1;
      else if (PREV_KEYS.has(e.key)) target = current - 1;
      else if (e.key === "Home") target = 1;
      else if (e.key === "End") target = count;
      if (target === null) return;
      e.preventDefault();
      go(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, count, go]);

  // Номер, кнопка и курсор видны, пока двигается мышь, и прячутся после IDLE_MS покоя. Мышь на панели или фокус
  // в ней — панель остаётся.
  const [idle, setIdle] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const scheduleIdle = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(function sleep() {
      if (bar.current?.matches(":hover, :focus-within")) timer.current = window.setTimeout(sleep, IDLE_MS);
      else setIdle(true);
    }, IDLE_MS);
  }, []);
  const wake = useCallback(() => {
    setIdle(false);
    scheduleIdle();
  }, [scheduleIdle]);

  useEffect(() => {
    scheduleIdle();
    // Нулевой сдвиг — синтетическое событие браузера после смены картинки под неподвижным курсором.
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerType === "mouse" && (e.movementX !== 0 || e.movementY !== 0)) wake();
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.clearTimeout(timer.current);
    };
  }, [scheduleIdle, wake]);

  // Соседи текущего слайда раскодированы заранее: смена слайда не ждёт декодирования 4K-картинки.
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const img of stage.current?.querySelectorAll("img") ?? []) void img.decode().catch(() => undefined);
  }, [current]);

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipedAt = useRef(Number.NEGATIVE_INFINITY);
  const anchor = useRef(0);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY };
    wake();
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || e.pointerType === "mouse") return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
    swipedAt.current = e.timeStamp;
    go(dx < 0 ? current + 1 : current - 1);
  };

  // Левая треть — назад, правые две трети — вперёд. Второй клик двойного: первый уже перелистнул — слайд
  // возвращается, полноэкранный режим переключается.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (current === 0 || e.timeStamp - swipedAt.current < AFTER_SWIPE_MS) return;
    if (e.detail === 2) {
      go(anchor.current);
      toggleFullscreen();
      return;
    }
    if (e.detail > 2) return;
    anchor.current = current;
    const box = e.currentTarget.getBoundingClientRect();
    go(e.clientX - box.left < box.width / 3 ? current - 1 : current + 1);
  };

  const shown: number[] = [];
  if (current > 0) for (let n = Math.max(1, current - BEHIND); n <= Math.min(count, current + AHEAD); n++) shown.push(n);
  const fullscreenLabel = fullscreen ? "Выйти из полноэкранного режима" : "Во весь экран";

  return (
    <main id="main" className="pitch" data-idle={idle}>
      <h1 className="tt-visually-hidden">Презентация</h1>
      <div
        ref={stage}
        className="pitch__stage"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {shown.map((n) => (
          <img
            key={n}
            className="pitch__slide"
            src={slideSrc(n)}
            width={SLIDE.width}
            height={SLIDE.height}
            alt={`Слайд ${n} из ${count}`}
            data-current={n === current}
            aria-hidden={n === current ? undefined : true}
            fetchPriority={n === current ? "high" : "low"}
            draggable={false}
          />
        ))}
      </div>
      <div ref={bar} className="pitch__bar" hidden={current === 0}>
        <p className="pitch__count" aria-live="polite" aria-atomic="true">
          {current > 0 ? (
            <>
              <span aria-hidden="true">
                {current} / {count}
              </span>
              <span className="tt-visually-hidden">
                Слайд {current} из {count}
              </span>
            </>
          ) : null}
        </p>
        {canFullscreen ? (
          <IconButton
            className="pitch__btn"
            label={fullscreenLabel}
            icon={fullscreen ? <ArrowsIn weight="bold" aria-hidden /> : <ArrowsOut weight="bold" aria-hidden />}
            onClick={(e) => {
              toggleFullscreen();
              // После щелчка мышью фокус уходит с кнопки: пробел и Enter снова листают слайды.
              if (e.detail > 0) e.currentTarget.blur();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
