import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getT } from "../../i18n/server";

// Объект, а не строка: строковый title обрывает шаблон «… · ТелеТау» для вложенных страниц (Next.js resolveTitle).
// generateMetadata, а не статика: заголовок зависит от языка интерфейса (cookie).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { default: t("Тропа"), template: "%s · ТелеТау" } };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
