"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Path, SignOut } from "@phosphor-icons/react/ssr";
import { Brand, Button, ButtonLink, Card, Chip, Dialog, HexAvatar, HoneyConfetti, IconButton, Illustration, LinkButton, TopBar, avatarFor, illustrations, toneFor } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { session } from "@teletau/session/client";
import { useRequireAccount, useResource } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import { useStudentPaths } from "../../_components/learn/paths";
import { ClassTitle, LoadError, LoadingBlock, Screen } from "../../_components/screens";

const seatLabel = (n: number) => `№${String(n).padStart(2, "0")}`;

/**
 * «Ты в классе 5 «Б»»: итог первого входа ученика (после выбора ника или подтверждения заявки). Учитель видит его как
 * «№07 · Смелая пчела». Повторные входы ведут сразу на тропу.
 */
export default function StudentClassPage() {
  const paths = useStudentPaths();
  const account = useRequireAccount("child", paths.login);
  const router = useRouter();
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const me = useResource(() => unwrap(api.GET("/api/v1/me")), [account?.id], { enabled: Boolean(account) });

  useEffect(() => {
    if (me.data) {
      session.updateAccount(me.data);
      if (!me.data.nickname) router.replace(paths.nickname);
    }
  }, [me.data, router, paths.nickname]);

  const current = me.data ?? account;
  const klass = current?.classes.find((c) => c.role === "student") ?? current?.classes[0];
  const nickname = current?.nickname;

  return (
    <Screen
      top={<TopBar start={<Brand href="/" />} end={<IconButton label={t("Выйти")} icon={<SignOut weight="bold" />} onClick={() => setLeaving(true)} />} />}
      className="joined"
    >
      {!current || (me.loading && !me.data) ? (
        <LoadingBlock rows={2} />
      ) : me.error && !me.data ? (
        <LoadError error={me.error} onRetry={me.reload} audience="child" />
      ) : (
        <div className="joined__body">
          {/* Первый вход в класс — маленький праздник (без анимации при «Уменьшении движения»). */}
          <HoneyConfetti />
          <Illustration name="sceneClassHive" width={200} alt={t("Пчёлы класса летят к общей борти")} className="joined__art" />
          <h1 className="tt-title1">
            {klass ? (
              <>
                {t("Ты в классе")} <ClassTitle title={klass.title} />
              </>
            ) : (
              t("Вход выполнен")
            )}
          </h1>
          {klass ? <p className="tt-lead">{klass.schoolName}</p> : null}
          <Card className="joined__card">
            <HexAvatar size={64} tone={toneFor(nickname ?? current.id)} art={avatarFor(nickname)} lip>
              {klass?.seatNumber ? String(klass.seatNumber).padStart(2, "0") : undefined}
            </HexAvatar>
            <div className="tt-stack tt-stack--tight">
              <p className="tt-headline">{nickname ?? t("Ник не выбран")}</p>
              {klass?.seatNumber ? <Chip tone="honey">{t("Место {n}", { n: seatLabel(klass.seatNumber) })}</Chip> : null}
            </div>
          </Card>
          <ButtonLink href={paths.learn} block icon={<Path weight="fill" aria-hidden />} className="joined__go">
            {t("На тропу")}
          </ButtonLink>
        </div>
      )}
      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={t("Уже уходишь?")}
        description={t("Войти снова можно по карточке или коду класса.")}
        art={illustrations.beeSympathy}
        centered
        hideClose
        actions={
          <>
            <Button block onClick={() => setLeaving(false)}>
              {t("Остаться")}
            </Button>
            <LinkButton
              tone="danger"
              onClick={async () => {
                await session.logout();
                // Полная загрузка, а не router.replace: закрытие диалога убирает свою запись истории (history.back
                // в sheetHistory), и пришедший popstate отменяет клиентский переход — страница оставалась на месте.
                window.location.replace(paths.start);
              }}
            >
              {t("Выйти")}
            </LinkButton>
          </>
        }
      />
    </Screen>
  );
}
