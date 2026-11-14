"use client";

import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react/ssr";
import { Button, ChoiceGroup, HexAvatar, InlineAlert, LinkButton, Skeleton, SkeletonGroup, avatarFor, toneFor } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { describeProblem } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { useT } from "../../i18n/client";

export interface PickedNickname {
  id: string;
  text: string;
}

/**
 * Выбор ника из словаря: три варианта из GET /nicknames/suggest и «Другие варианты».
 * Свободного ввода нет — ребёнок не может написать имя (ADR 0009).
 */
export function NicknamePicker({
  submitLabel,
  submitting,
  error,
  onPick,
}: {
  submitLabel: string;
  submitting?: boolean;
  error?: string | null;
  onPick: (nick: PickedNickname) => void;
}) {
  const [round, setRound] = useState(0);
  // Выбранный ник — объектом, а не только id: даже если список под рукой перечитается (webview
  // Telegram периодически «просыпает» вкладку), выбор не теряется и кнопка не гаснет.
  const [picked, setPicked] = useState<PickedNickname | null>(null);
  const t = useT();
  const suggestions = useResource(() => unwrap(api.GET("/api/v1/nicknames/suggest", { params: { query: { count: 3 } } })), [round]);
  const items = suggestions.data?.items ?? [];
  const chosen = picked;

  return (
    <div className="tt-stack">
      {suggestions.loading && !items.length ? (
        <SkeletonGroup label={t("Подбираем ники")} className="tt-stack tt-stack--tight">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={60} radius="button" />
          ))}
        </SkeletonGroup>
      ) : suggestions.error && !items.length ? (
        // Повтор — рядом с ошибкой, а не спрятан в «Другие варианты».
        <div className="tt-stack tt-stack--tight">
          <InlineAlert tone="danger">{describeProblem(suggestions.error, "child")}</InlineAlert>
          <Button variant="secondary" icon={<ArrowsClockwise weight="bold" />} loading={suggestions.loading} onClick={suggestions.reload}>
            {t("Попробовать снова")}
          </Button>
        </div>
      ) : (
        <ChoiceGroup
          legend={t("Варианты ника")}
          hideLegend
          value={picked?.id ?? null}
          onChange={(id: string) => setPicked(items.find((n) => n.id === id) ?? null)}
          options={items.map((n) => ({ value: n.id, label: n.text, mark: <HexAvatar size={36} tone={toneFor(n.text)} art={avatarFor(n.text)} /> }))}
        />
      )}
      {items.length ? (
        <LinkButton
          icon={<ArrowsClockwise weight="bold" />}
          onClick={() => {
            setPicked(null);
            setRound((r) => r + 1);
          }}
          disabled={suggestions.loading || submitting}
        >
          {t("Другие варианты")}
        </LinkButton>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <Button block disabled={!chosen} loading={submitting} onClick={() => chosen && onPick(chosen)}>
        {submitLabel}
      </Button>
    </div>
  );
}
