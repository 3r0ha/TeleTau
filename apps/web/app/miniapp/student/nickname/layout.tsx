import type { Metadata } from "next";
import { getT } from "../../../../i18n/server";

// Telegram Mini App: экран тот же; заголовок задаём сами — реэкспорт metadata из веб-layout хрупок
// (layout-ы веба переезжают на generateMetadata, имена экспортов меняются).
export { default } from "../../../student/nickname/layout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { default: t("Выбери ник"), template: "%s · ТелеТау" } };
}
