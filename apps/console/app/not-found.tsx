import type { Metadata } from "next";
import { Brand, ButtonLink, EmptyState, TopBar } from "@teletau/ui";

export const metadata: Metadata = { title: "Страница не найдена" };

/** 404 в фирменном виде (стандартная страница Next.js рисуется атрибутами style — строгая CSP их не применит). */
export default function NotFound() {
  return (
    <div className="tt-page console">
      <TopBar wide start={<Brand href="/" subtitle="Консоль" />} />
      <main id="main" className="tt-main">
        <div className="tt-column tt-column--wide console__body">
          <EmptyState
            art="beeThink"
            title="Такой страницы нет"
            actions={
              <ButtonLink href="/" block>
                На главную
              </ButtonLink>
            }
          >
            Проверьте адрес.
          </EmptyState>
        </div>
      </main>
    </div>
  );
}
