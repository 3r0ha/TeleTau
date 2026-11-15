"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react/ssr";
import { IconButton } from "./Button";
import { useUiStrings } from "./UiStrings";

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  text: ReactNode;
}

type ShowToast = (text: ReactNode, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast>(() => {});

/** Показать тост: `const toast = useToast(); toast("Карточка перевыпущена")`. */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const ICONS = { success: CheckCircle, error: WarningCircle, info: Info } as const;

/** Верхний открытый модальный лист (<dialog> через showModal) или null. */
function topModalDialog(): HTMLDialogElement | null {
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).filter(
    (d) => {
      try {
        return d.matches(":modal");
      } catch {
        return true; // браузер без :modal — считаем открытый <dialog> модальным
      }
    },
  );
  return open.at(-1) ?? null;
}

/**
 * Куда рисовать тосты. Модальный лист (showModal) лежит в верхнем слое браузера: тост снаружи оказывается под ним
 * при любом z-index, а остальная страница инертна — тост не видно и читалка его не объявляет. Поэтому, пока лист
 * открыт, область тостов переносится внутрь него; лист закрылся — обратно на страницу. Переносится и пустая область:
 * к первому тосту она уже лежит в листе, и его текст — добавление в живую область, которое читалка объявляет
 * (область, созданная сразу с текстом, не объявляется).
 */
function useToastHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const pick = () => setHost(topModalDialog());
    pick();
    const watch = new MutationObserver(pick);
    watch.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
      childList: true,
    });
    return () => watch.disconnect();
  }, []);
  return host;
}
const LIFETIME_MS = 5000;

/**
 * Тосты: короткие сообщения о результате действия. Область — живая (aria-live), ошибки — role="alert".
 * Тост можно закрыть; он исчезает сам через 5 с.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const s = useUiStrings();
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const show = useCallback<ShowToast>(
    (text, tone = "success") => {
      const id = next.current++;
      setItems((list) => [...list.slice(-2), { id, tone, text }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => show, [show]);
  const host = useToastHost();
  const region = (
    <div
      className="tt-toasts"
      aria-live="polite"
      aria-relevant="additions"
      role="region"
      aria-label={s.toasts}
    >
      {items.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            className={`tt-toast tt-toast--${t.tone}`}
            role={t.tone === "error" ? "alert" : undefined}
          >
            <span className="tt-toast__icon" aria-hidden>
              <Icon weight="fill" />
            </span>
            <span className="tt-toast__text">{t.text}</span>
            <IconButton
              label={s.toastHide}
              icon={<X weight="bold" />}
              onClick={() => dismiss(t.id)}
            />
          </div>
        );
      })}
    </div>
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      {host ? createPortal(region, host) : region}
    </ToastContext.Provider>
  );
}
