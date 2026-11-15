"use client";

import { usePathname } from "next/navigation";
import { Button, ButtonLink, EmptyState } from "@teletau/ui";
import { useT } from "../i18n/client";
import { Screen } from "./_components/screens";

/** Сбой экрана в фирменном виде: без текста ошибки и технических подробностей. В Mini App «На главную» — в Mini App. */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  const home = /^\/miniapp(\/|$)/.test(usePathname() ?? "") ? "/miniapp" : "/";
  const t = useT();
  return (
    <Screen>
      <EmptyState
        art="emptyError"
        title={t("Что-то пошло не так")}
        role="alert"
        actions={
          <>
            <Button block onClick={retry}>
              {t("Попробовать ещё раз")}
            </Button>
            <ButtonLink href={home} variant="secondary" block>
              {t("На главную")}
            </ButtonLink>
          </>
        }
      />
    </Screen>
  );
}
