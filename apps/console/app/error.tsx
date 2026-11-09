"use client";

import { Brand, Button, ButtonLink, EmptyState, TopBar } from "@teletau/ui";

/** Сбой экрана консоли в фирменном виде: без текста ошибки и технических подробностей. */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="tt-page console">
      <TopBar wide start={<Brand href="/" subtitle="Консоль" />} />
      <main id="main" className="tt-main">
        <div className="tt-column tt-column--wide console__body">
          <EmptyState
            art="emptyError"
            title="Что-то пошло не так"
            role="alert"
            actions={
              <>
                <Button block onClick={retry}>
                  Попробовать снова
                </Button>
                <ButtonLink href="/" variant="secondary" block>
                  На главную
                </ButtonLink>
              </>
            }
          />
        </div>
      </main>
    </div>
  );
}
