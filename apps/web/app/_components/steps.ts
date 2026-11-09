"use client";

import { useMemo } from "react";

/**
 * Шаги пошагового сценария — в адресе (`?step=…`): системная кнопка «Назад» (Android, жест iOS, браузер)
 * возвращает на предыдущий шаг, а не уводит со страницы и не стирает введённое. Шаг меняется через
 * window.history.pushState: Next.js синхронизирует с ним useSearchParams без запроса к серверу.
 * В состоянии записи истории — с какого шага на неё пришли (`ttFrom`): стрелка «Назад» экрана делает history.back(),
 * только если предыдущая запись — действительно предыдущий шаг (иначе, например после перезагрузки, — замена адреса).
 */
export function useFlowSteps<S extends string>(first: S) {
  return useMemo(() => {
    const url = (step: S) => {
      const u = new URL(window.location.href);
      if (step === first) u.searchParams.delete("step");
      else u.searchParams.set("step", step);
      return `${u.pathname}${u.search}`;
    };
    const current = (): S => (new URL(window.location.href).searchParams.get("step") as S | null) ?? first;
    return {
      /** Следующий шаг — новая запись истории. */
      go(step: S) {
        window.history.pushState({ ttFrom: current() }, "", url(step));
      },
      /** Заменить шаг без новой записи (недоступный шаг, исправление адреса). */
      replace(step: S) {
        window.history.replaceState({}, "", url(step));
      },
      /** «Назад» экрана: к шагу prev — по истории, если пришли с него, иначе заменой адреса. */
      back(prev: S) {
        const from = (window.history.state as { ttFrom?: string } | null)?.ttFrom;
        if (from === prev) window.history.back();
        else window.history.replaceState({}, "", url(prev));
      },
    };
  }, [first]);
}
