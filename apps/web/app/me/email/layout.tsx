import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Сохранить по почте" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
