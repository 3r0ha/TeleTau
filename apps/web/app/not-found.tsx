import type { Metadata } from "next";
import { ButtonLink, EmptyState } from "@teletau/ui";
import { Screen, SimpleTop } from "./_components/screens";

export const metadata: Metadata = { title: "Страница не найдена" };

/** 404 в фирменном виде (стандартная страница Next.js рисуется атрибутами style — строгая CSP их не применит). */
export default function NotFound() {
  return (
    <Screen top={<SimpleTop back="/" title="Страница не найдена" />}>
      <EmptyState
        art="beeThink"
        title="Такой страницы нет"
        actions={
          <ButtonLink href="/" block>
            На главную
          </ButtonLink>
        }
      >
        Ссылка устарела или в адресе опечатка.
      </EmptyState>
    </Screen>
  );
}
