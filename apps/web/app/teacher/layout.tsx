import type { Metadata } from "next";
import type { ReactNode } from "react";
// Экраны кабинета: «Прогресс» класса и «Помогите языку».
import "./teacher.css";

// Объект, а не строка: строковый title обрывает шаблон «… · ТелеТау» для вложенных страниц (Next.js resolveTitle).
export const metadata: Metadata = { title: { default: "Мои классы", template: "%s · ТелеТау" } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
