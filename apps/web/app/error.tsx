"use client";

import { usePathname } from "next/navigation";
import { Button, ButtonLink, EmptyState } from "@teletau/ui";
import { Screen } from "./_components/screens";

/** Сбой экрана в фирменном виде: без текста ошибки и технических подробностей. В Mini App «На главную» — в Mini App. */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  const home = /^\/miniapp(\/|$)/.test(usePathname() ?? "") ? "/miniapp" : "/";
  return (
    <Screen>
      <EmptyState
        art="emptyError"
        title="Что-то пошло не так"
        role="alert"
        actions={
          <>
            <Button block onClick={retry}>
              Попробовать снова
            </Button>
            <ButtonLink href={home} variant="secondary" block>
              На главную
            </ButtonLink>
          </>
        }
      />
    </Screen>
  );
}
