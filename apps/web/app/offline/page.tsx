import type { Metadata } from "next";
import { EmptyState, buttonClass } from "@teletau/ui";
import { Screen } from "../_components/screens";
import { getT } from "../../i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Нет связи"), robots: { index: false, follow: false } };
}

/**
 * «Нет связи» для service worker (public/sw.js): он кладёт эту страницу в кеш и показывает её без сети по тому адресу,
 * который открывали. Работает без скриптов: «Попробовать снова» — ссылка на текущий адрес.
 */
export default async function OfflinePage() {
  const t = await getT();
  return (
    <Screen>
      <EmptyState
        art="emptyOffline"
        title={t("Нет связи")}
        actions={
          <a href="" className={buttonClass({ block: true })}>
            {t("Попробовать снова")}
          </a>
        }
      />
    </Screen>
  );
}
