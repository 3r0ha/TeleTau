import type { Metadata } from "next";
import { ButtonLink, EmptyState } from "@teletau/ui";
import { getT } from "../i18n/server";
import { Screen, SimpleTop } from "./_components/screens";

export const metadata: Metadata = { title: "Страница не найдена" };

/** 404 в фирменном виде (стандартная страница Next.js рисуется атрибутами style — строгая CSP их не применит). */
export default async function NotFound() {
  const t = await getT();
  return (
    <Screen top={<SimpleTop back="/" />}>
      <EmptyState
        art="beeThink"
        title={t("Страница не найдена")}
        actions={
          <ButtonLink href="/" block>
            {t("На главную")}
          </ButtonLink>
        }
      >
        {t("Ссылка устарела или в адресе опечатка.")}
      </EmptyState>
    </Screen>
  );
}
