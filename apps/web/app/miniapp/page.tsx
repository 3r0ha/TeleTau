"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Splash } from "../_components/learn/StudentShell";

/**
 * Вход в Mini App — адрес кнопки меню бота. Сразу на тропу (без сессии тропа сама отправит ко входу по карточке);
 * заставка — та же, что у тропы, поэтому переход не мигает.
 */
export default function MiniAppEntry() {
  const router = useRouter();
  useEffect(() => router.replace("/miniapp/learn"), [router]);
  return <Splash />;
}
