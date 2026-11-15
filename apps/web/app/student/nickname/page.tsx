"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignOut } from "@phosphor-icons/react/ssr";
import { LinkButton } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { describeProblem } from "@teletau/session/problem";
import { useRequireAccount } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import { LoadingBlock, Screen, SimpleTop } from "../../_components/screens";
import { useStudentPaths } from "../../_components/learn/paths";
import { NicknamePicker, type PickedNickname } from "../NicknamePicker";

/**
 * Первый вход по карточке: выбор ника (PATCH /me { nicknameId }). Дети путают карточки: если карточка чужая,
 * отсюда можно выйти, не выбирая ник на чужом месте.
 */
export default function NicknamePage() {
  const paths = useStudentPaths();
  const me = useRequireAccount("child", paths.login);
  const router = useRouter();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    setLeaving(true);
    await session.logout();
    router.replace(paths.login);
  };

  const pick = async (nick: PickedNickname) => {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await unwrap(api.PATCH("/api/v1/me", { body: { nicknameId: nick.id } }));
      session.updateAccount(updated);
      // Ник выбирают при первом входе — дальше «Ты в классе» с кнопкой «На тропу».
      router.replace(paths.joined);
    } catch (e) {
      setError(describeProblem(e, "child", t));
      setSubmitting(false);
    }
  };

  return (
    <Screen top={<SimpleTop title={t("Твой ник")} />}>
      {!me ? (
        <LoadingBlock />
      ) : (
        <div className="tt-stack tt-stack--loose">
          <header className="tt-stack tt-stack--tight">
            <h1 className="tt-title2">{t("Выбери ник")}</h1>
            <p className="tt-lead">{t("Так тебя увидят в классе.")}</p>
          </header>
          <NicknamePicker
            submitLabel={t("Выбрать")}
            submitting={submitting}
            error={error}
            onPick={(nick) => void pick(nick)}
          />
          <LinkButton tone="neutral" icon={<SignOut weight="bold" aria-hidden />} onClick={() => void leave()} disabled={leaving || submitting}>
            {t("Это не моя карточка")}
          </LinkButton>
        </div>
      )}
    </Screen>
  );
}
