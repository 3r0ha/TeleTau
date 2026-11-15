"use client";

import { Button, EmptyState } from "@teletau/ui";
import { describeProblem, isNetworkError } from "@teletau/session/problem";

/** Данные раздела не загрузились: нет сети — своя картинка и заголовок, ошибка API — понятный текст; действие — повтор. */
export function LoadFailure({ error, onRetry, headingAs }: { error: unknown; onRetry: () => void; headingAs?: "h2" | "h3" }) {
  const offline = isNetworkError(error);
  return (
    <EmptyState
      art={offline ? "emptyOffline" : "emptyError"}
      headingAs={headingAs}
      compact
      title={offline ? "Нет связи" : "Не удалось загрузить"}
      role="alert"
      actions={
        <Button block onClick={onRetry}>
          Попробовать снова
        </Button>
      }
    >
      {describeProblem(error)}
    </EmptyState>
  );
}
