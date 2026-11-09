"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ConsoleShell } from "./_components/ConsoleShell";
import { homeOf } from "./_components/sections";
import type { Me } from "@teletau/session/types";

/** Главная консоли — первый раздел по ролям сотрудника (без входа ConsoleShell перейдёт на /login). */
export default function ConsoleHome() {
  return <ConsoleShell>{(me) => <GoHome me={me} />}</ConsoleShell>;
}

function GoHome({ me }: { me: Me }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(homeOf(me));
  }, [me, router]);
  return null;
}
