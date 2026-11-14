"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import tokens from "@teletau/design-tokens/tokens.json";
import { useToast } from "@teletau/ui";
import { useSession } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import { useStudentPaths } from "../learn/paths";
import { backAction, isSheetEntry, type BackAction } from "./miniapp-nav";
import { connectTelegram, type TelegramBridge, type TelegramWindow } from "./telegram-bridge";
import { linkTelegramChat } from "./telegram-link";

let shared: TelegramBridge | null = null;

/** Мост — один на загрузку страницы: параметры запуска читаются из адреса один раз, до переходов роутера. */
function telegramBridge(): TelegramBridge | null {
  if (typeof window === "undefined") return null;
  shared ??= connectTelegram(window as unknown as TelegramWindow);
  return shared;
}

export interface TelegramState {
  bridge: TelegramBridge | null;
  /** Проверка уже прошла (на сервере и при первой отрисовке — false: экран не мигает между вариантами). */
  checked: boolean;
  inTelegram: boolean;
  /** Сканер QR Telegram (мобильный клиент 6.4+). */
  canScanQr: boolean;
}

const TelegramContext = createContext<TelegramState>({ bridge: null, checked: false, inTelegram: false, canScanQr: false });

export function useTelegram(): TelegramState {
  return useContext(TelegramContext);
}

/** Как часто сверять, открыт ли лист (pushState листов не даёт событий; дёшево и только внутри Telegram). */
const SHEET_POLL_MS = 250;

/**
 * Telegram Mini App поверх экранов ученика (docs/plans/M2.md §3 «Ч5»): web_app_ready и web_app_expand, всегда светлая
 * тема (`data-theme="light"` на <html>, тема Telegram не учитывается), шапка и фон Telegram — в цвет светлого фона из
 * токенов, системная кнопка «Назад» и привязка чата с ботом после входа (initData — один раз, ADR 0020). Вне Telegram
 * ничего не делает — /miniapp работает как обычный веб.
 */
export function TelegramProvider({ children }: { children: ReactNode }) {
  // Подключаемся при первой отрисовке на клиенте — раньше эффектов страниц, которые меняют адрес.
  const [bridge] = useState(telegramBridge);
  const [state, setState] = useState<TelegramState>({ bridge: null, checked: false, inTelegram: false, canScanQr: false });

  useEffect(() => {
    if (!bridge?.inTelegram) {
      setState((s) => ({ ...s, checked: true }));
      return;
    }
    setState({ bridge, checked: true, inTelegram: true, canScanQr: bridge.canScanQr });
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = "light";
    bridge.setColors(tokens.light["color.bg"]);
    root.dataset.telegram = bridge.platform;
    bridge.ready();
    bridge.expand();
    return () => {
      if (before === undefined) delete root.dataset.theme;
      else root.dataset.theme = before;
      delete root.dataset.telegram;
    };
  }, [bridge]);

  return (
    <TelegramContext.Provider value={state}>
      {state.inTelegram && state.bridge ? <BackButton bridge={state.bridge} /> : null}
      {state.inTelegram && state.bridge ? <LinkChat bridge={state.bridge} /> : null}
      {children}
    </TelegramContext.Provider>
  );
}

/**
 * Привязка чата с ботом (ADR 0020): как только в этой вкладке есть вход (карточка, код класса или уже открытая сессия),
 * initData этого запуска один раз уходит в POST /api/v1/telegram/link. takeInitData отдаёт строку однажды — повторный
 * рендер, StrictMode и выход со входом заново её не пошлют. Напоминания при этом не включаются: только по согласию в боте.
 */
function LinkChat({ bridge }: { bridge: TelegramBridge }) {
  const authenticated = useSession().status === "authenticated";
  const toast = useToast();
  const t = useT();
  useEffect(() => {
    if (!authenticated) return;
    const initData = bridge.takeInitData();
    // Молчать нельзя: человек решит, что бот подключён, а напоминания о серии не придут.
    if (initData)
      void linkTelegramChat(initData).then((ok) => {
        if (!ok) toast(t("Не получилось связать аккаунт с ботом. Напоминания пока не придут."), "info");
      });
  }, [authenticated, bridge, toast, t]);
  return null;
}

/** Системная «Назад» Telegram: видна, когда есть куда вернуться (miniapp-nav.ts), и ведёт туда же, куда «Назад» веба. */
function BackButton({ bridge }: { bridge: TelegramBridge }) {
  const pathname = usePathname();
  const router = useRouter();
  const paths = useStudentPaths();
  const [sheetOpen, setSheetOpen] = useState(false);
  const action = backAction(pathname, paths, sheetOpen);
  const actionRef = useRef<BackAction>(action);
  actionRef.current = action;

  useEffect(() => {
    const check = () => setSheetOpen(isSheetEntry(window.history.state));
    check();
    const timer = setInterval(check, SHEET_POLL_MS);
    window.addEventListener("popstate", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("popstate", check);
    };
  }, []);

  useEffect(() => bridge.setBackButton(action !== "none"), [bridge, action]);
  useEffect(() => () => bridge.setBackButton(false), [bridge]);

  useEffect(
    () =>
      bridge.on("back_button_pressed", () => {
        if (actionRef.current === "trail") router.replace(paths.learn);
        else if (actionRef.current === "history") window.history.back();
      }),
    [bridge, router, paths.learn],
  );
  return null;
}
