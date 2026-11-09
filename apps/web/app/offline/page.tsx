import type { Metadata } from "next";
import { EmptyState, buttonClass } from "@teletau/ui";
import { Screen } from "../_components/screens";

export const metadata: Metadata = { title: "Нет связи", robots: { index: false, follow: false } };

/**
 * «Нет связи» для service worker (public/sw.js): он кладёт эту страницу в кеш и показывает её без сети по тому адресу,
 * который открывали. Работает без скриптов: «Попробовать снова» — ссылка на текущий адрес.
 */
export default function OfflinePage() {
  return (
    <Screen>
      <EmptyState
        art="emptyOffline"
        title="Нет связи"
        actions={
          <a href="" className={buttonClass({ block: true })}>
            Попробовать снова
          </a>
        }
      />
    </Screen>
  );
}
