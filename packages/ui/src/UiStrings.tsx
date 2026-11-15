"use client";

import { createContext, useContext, type ReactNode } from "react";
import { RU_UI_STRINGS, type UiStrings } from "./strings";

const UiStringsContext = createContext<UiStrings>(RU_UI_STRINGS);

/** Переводы строк пакета для поддерева (веб — в корневом layout по языку из cookie). */
export function UiStringsProvider({ strings, children }: { strings: UiStrings; children: ReactNode }) {
  return <UiStringsContext.Provider value={strings}>{children}</UiStringsContext.Provider>;
}

/** Строки пакета на языке приложения; без провайдера — русские. */
export function useUiStrings(): UiStrings {
  return useContext(UiStringsContext);
}
