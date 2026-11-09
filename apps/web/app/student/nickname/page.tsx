"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignOut } from "@phosphor-icons/react/ssr";
import { LinkButton } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { useRequireAccount } from "@teletau/session/react";
import { LoadingBlock, Screen, SimpleTop } from "../../_components/screens";
import { useStudentPaths } from "../../_components/learn/paths";
import { NicknamePicker } from "../NicknamePicker";

/**
 * Первый вход по карточке: выбор ника (PATCH /me { nicknameId }). Дети путают карточки: если карточка чужая,
 * отсюда можно выйти, не выбирая ник на чужом месте.
 */
export default function NicknamePage() {
  const paths = useStudentPaths();
  const me = useRequireAccount("child", paths.login);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    setLeaving(true);
    await session.logout();
    router.replace(paths.login);
  };

  return (
    <Screen top={<SimpleTop title="Твой ник" />}>
      {!me ? (
        <LoadingBlock />
      ) : (
        <div className="tt-stack tt-stack--loose">
          <header className="tt-stack tt-stack--tight">
            <h1 className="tt-title2">Выбери ник</h1>
            <p className="tt-lead">Так тебя увидят в классе.</p>
          </header>
          <NicknamePicker
            submitLabel="Выбрать"
            submitting={submitting}
            error={error}
            onPick={async (nick) => {
              setSubmitting(true);
              setError(null);
              try {
                const updated = await unwrap(api.PATCH("/api/v1/me", { body: { nicknameId: nick.id } }));
                session.updateAccount(updated);
                // Ник выбирают при первом входе — дальше «Ты в классе» с кнопкой «На тропу».
                router.replace(paths.joined);
              } catch (e) {
                setError(describeProblem(e, "child"));
                setSubmitting(false);
              }
            }}
          />
          <LinkButton tone="neutral" icon={<SignOut weight="bold" aria-hidden />} onClick={() => void leave()} disabled={leaving || submitting}>
            Это не моя карточка
          </LinkButton>
        </div>
      )}
    </Screen>
  );
}
