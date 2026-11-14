import type { Metadata } from "next";
import type { ReactNode } from "react";
// Экраны кабинета: «Прогресс» класса и «Помогите языку».
import { getT } from "../../i18n/server";
import "./teacher.css";

// Объект, а не строка: строковый title обрывает шаблон «… · ТелеТау» для вложенных страниц (Next.js resolveTitle).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { default: t("Мои классы"), template: "%s · ТелеТау" } };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
