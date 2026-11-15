// Режим «Пчёлка» до входа (docs/05 §7): экраны входа ученика и «Учусь сам» — крупные цели, и на сайте, и под /miniapp.
import { describe, expect, it } from "vitest";
import type { SessionState } from "@teletau/session/types";
import { uiModeFor } from "../app/_components/UiMode";

const anonymous: SessionState = { status: "anonymous" };

describe("возрастной режим до входа", () => {
  it("вход ученика и «Учусь сам» — «Пчёлка» на сайте и в Mini App", () => {
    for (const path of ["/q", "/student", "/student/code", "/student/wait", "/self", "/miniapp/student", "/miniapp/student/code", "/miniapp/student/wait", "/miniapp/self"]) {
      expect(uiModeFor(anonymous, path), path).toBe("bee");
    }
  });

  it("лендинг, вход взрослого и тропа без сессии — без режима", () => {
    for (const path of ["/", "/miniapp", "/teacher/login", "/miniapp/student/email", "/miniapp/learn", "/miniappself"]) {
      expect(uiModeFor(anonymous, path), path).toBeUndefined();
    }
  });
});
