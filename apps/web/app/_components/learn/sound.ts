"use client";

// Звуки интерфейса ученика (docs/05 §9): короткие ноты, синтезированные Web Audio API, — без файлов и чужих адресов.
// Звучат, только если ученик не выключил их в профиле (настройка этого устройства), вкладка видна и сейчас не играет
// запись носителя («Послушать» важнее: SpeakButton сообщает о себе событием tt-speech, и звук интерфейса замолкает).
// Web Audio на iPhone и iPad молчит при беззвучном режиме — системная настройка соблюдается сама.
import { useSyncExternalStore } from "react";

export type SoundName =
  "tap" | "correct" | "almost" | "wrong" | "voted" | "newWord" | "complete" | "streak" | "levelUp";

const KEY = "teletau.sounds";
const listeners = new Set<() => void>();
let stored: boolean | null = null;

function readStored(): boolean {
  if (stored !== null) return stored;
  try {
    stored = window.localStorage.getItem(KEY) !== "off";
  } catch {
    stored = true;
  }
  return stored;
}

/** Включены ли звуки на этом устройстве (по умолчанию — да). */
export function soundsOn(): boolean {
  return typeof window === "undefined" ? false : readStored();
}

export function setSoundsOn(on: boolean): void {
  stored = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Хранилище недоступно (приватный режим) — настройка живёт до перезагрузки.
  }
  if (!on) silence();
  listeners.forEach((l) => l());
}

/** Выключатель «Звуки» в профиле. */
export function useSoundsOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    soundsOn,
    () => false,
  );
}

// ───── движок ─────
type Ctx = { ctx: AudioContext; out: GainNode };
let engine: Ctx | null = null;
let speaking = false;
let primed = false;

function getEngine(): Ctx | null {
  if (engine) return engine;
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(comp);
    comp.connect(ctx.destination);
    engine = { ctx, out };
  } catch {
    engine = null;
  }
  return engine;
}

/** Мягко заглушить то, что звучит сейчас (запись носителя началась или звуки выключили). */
function silence() {
  if (!engine) return;
  const { ctx, out } = engine;
  const t = ctx.currentTime;
  out.gain.cancelScheduledValues(t);
  out.gain.setValueAtTime(out.gain.value, t);
  out.gain.linearRampToValueAtTime(0, t + 0.06);
}

/**
 * Подготовить звук: браузер разрешает его только после нажатия, поэтому контекст будится первым касанием или клавишей
 * на экране урока. Вызывать можно сколько угодно раз.
 */
export function primeSounds(): void {
  if (primed || typeof window === "undefined") return;
  primed = true;
  const wake = () => {
    if (!soundsOn()) return;
    const e = getEngine();
    if (e && e.ctx.state === "suspended") void e.ctx.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", wake, { capture: true, passive: true });
  window.addEventListener("keydown", wake, { capture: true });
  window.addEventListener("tt-speech", (e) => {
    speaking = Boolean((e as CustomEvent<boolean>).detail);
    if (speaking) silence();
  });
}

interface Note {
  /** Частота, Гц. */
  f: number;
  /** Начало от момента звука, с. */
  at: number;
  /** Длительность, с. */
  dur: number;
  gain: number;
  wave?: OscillatorType;
  /** Скользнуть к частоте к концу ноты. */
  to?: number;
  /** Обертон октавой выше (тихий): «деревянный» тембр, ближе к кураю, чем чистый синус. */
  overtone?: number;
  /** Срез высоких частот, Гц: глухой тон. */
  lowpass?: number;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const B5 = 987.77;
const C6 = 1046.5;
const D6 = 1174.66;
const E6 = 1318.51;
const G4 = 392;

const SOUNDS: Record<SoundName, Note[]> = {
  // Касание плитки: короткий «пузырёк».
  tap: [{ f: 620, to: 380, at: 0, dur: 0.07, gain: 0.07, wave: "sine" }],
  // Верно: две восходящие ноты.
  correct: [
    { f: E5, at: 0, dur: 0.14, gain: 0.16, overtone: 0.25 },
    { f: B5, at: 0.09, dur: 0.34, gain: 0.16, overtone: 0.25 },
  ],
  // Почти: ответ засчитан — мягче и короче, чем «верно».
  almost: [
    { f: E5, at: 0, dur: 0.14, gain: 0.13, overtone: 0.2 },
    { f: G5, at: 0.1, dur: 0.3, gain: 0.13, overtone: 0.2 },
  ],
  // Неверно: два глухих низких тона вниз — без резкого «зуммера».
  wrong: [
    { f: 233.08, at: 0, dur: 0.16, gain: 0.2, wave: "triangle", lowpass: 900 },
    { f: 185, at: 0.13, dur: 0.3, gain: 0.2, wave: "triangle", lowpass: 700 },
  ],
  // Голос учтён: колокольчик двумя нотами сразу.
  voted: [
    { f: C6, at: 0, dur: 0.42, gain: 0.09 },
    { f: E6, at: 0.03, dur: 0.42, gain: 0.07 },
  ],
  // Новое слово: мягкий колокольчик снизу вверх — тише «Голос учтён», без обертонов: знакомство, а не оценка.
  newWord: [
    { f: G5, at: 0, dur: 0.24, gain: 0.06 },
    { f: C6, at: 0.09, dur: 0.42, gain: 0.05 },
  ],
  // Урок пройден: арпеджио и аккорд.
  complete: [
    { f: C5, at: 0, dur: 0.16, gain: 0.13, overtone: 0.2 },
    { f: E5, at: 0.11, dur: 0.16, gain: 0.13, overtone: 0.2 },
    { f: G5, at: 0.22, dur: 0.16, gain: 0.13, overtone: 0.2 },
    { f: C6, at: 0.33, dur: 0.7, gain: 0.14, overtone: 0.2 },
    { f: G5, at: 0.33, dur: 0.7, gain: 0.06 },
    { f: E5, at: 0.33, dur: 0.7, gain: 0.05 },
  ],
  // Серия: тёплый подъём.
  streak: [
    { f: G4, at: 0, dur: 0.18, gain: 0.12, overtone: 0.25 },
    { f: C5, at: 0.12, dur: 0.18, gain: 0.12, overtone: 0.25 },
    { f: E5, at: 0.24, dur: 0.6, gain: 0.13, overtone: 0.25 },
    { f: G5, at: 0.24, dur: 0.6, gain: 0.07 },
  ],
  // Новая лига: короткие фанфары.
  levelUp: [
    { f: G5, at: 0, dur: 0.12, gain: 0.12, overtone: 0.25 },
    { f: G5, at: 0.13, dur: 0.12, gain: 0.12, overtone: 0.25 },
    { f: C6, at: 0.26, dur: 0.2, gain: 0.13, overtone: 0.25 },
    { f: A5, at: 0.46, dur: 0.12, gain: 0.11, overtone: 0.25 },
    { f: D6, at: 0.58, dur: 0.18, gain: 0.12, overtone: 0.25 },
    { f: E6, at: 0.76, dur: 0.8, gain: 0.12, overtone: 0.2 },
    { f: C6, at: 0.76, dur: 0.8, gain: 0.06 },
  ],
};

function voice({ ctx, out }: Ctx, n: Note, t0: number) {
  const start = t0 + n.at;
  const end = start + n.dur;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(n.gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  let sink: AudioNode = env;
  if (n.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = n.lowpass;
    lp.connect(env);
    sink = lp;
  }
  env.connect(out);
  const osc = (freq: number, wave: OscillatorType, level: number) => {
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(freq, start);
    if (n.to) o.frequency.exponentialRampToValueAtTime(n.to * (freq / n.f), end);
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g);
    g.connect(sink);
    o.start(start);
    o.stop(end + 0.02);
  };
  osc(n.f, n.wave ?? "sine", 1);
  if (n.overtone) osc(n.f * 2, "sine", n.overtone);
}

/** Сыграть звук интерфейса. Молчит, если звуки выключены, вкладка скрыта, играет запись или браузер не умеет звук. */
export function playSound(name: SoundName): void {
  if (
    typeof document === "undefined" ||
    !soundsOn() ||
    speaking ||
    document.visibilityState !== "visible"
  )
    return;
  primeSounds();
  const e = getEngine();
  if (!e) return;
  const run = () => {
    const t = e.ctx.currentTime + 0.01;
    e.out.gain.cancelScheduledValues(t);
    e.out.gain.setValueAtTime(0.9, t);
    for (const n of SOUNDS[name]) voice(e, n, t);
  };
  if (e.ctx.state === "suspended") void e.ctx.resume().then(run, () => undefined);
  else run();
}
