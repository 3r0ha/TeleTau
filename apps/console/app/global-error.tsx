"use client";

// Заменяет корневой layout при его сбое: свой документ и свои стили (стили layout сюда не доходят). Тема — системная.
import "@teletau/ui/ui.css";
import "./globals.css";
import { Button, EmptyState, buttonClass } from "@teletau/ui";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ru">
      <body>
        <title>Что-то пошло не так · Консоль ТелеТау</title>
        <div className="tt-page console">
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
                    {/* Полная загрузка: роутер приложения после такого сбоя мог не подняться. */}
                    <a href="/" className={buttonClass({ variant: "secondary", block: true })}>
                      На главную
                    </a>
                  </>
                }
              />
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
