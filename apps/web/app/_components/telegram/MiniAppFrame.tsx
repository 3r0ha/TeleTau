"use client";

import type { ReactNode } from "react";
import { RoutePrefix } from "../learn/paths";
import { TelegramProvider } from "./TelegramProvider";

/** Каркас Telegram Mini App: экраны ученика под префиксом /miniapp и мост с клиентом Telegram. */
export function MiniAppFrame({ children }: { children: ReactNode }) {
  return (
    <RoutePrefix prefix="/miniapp">
      <TelegramProvider>{children}</TelegramProvider>
    </RoutePrefix>
  );
}
