// Демо-вход сотрудников без TOTP (AUTH_DEMO_STAFF_WITHOUT_TOTP, день 3): жюри не нужен аутентификатор —
// «почта → код», двухшаговый вход. Флаг действует только вместе с демо-сотрудниками и не в production (config.ts);
// обычный вход сотрудника без флага требует TOTP — m1-flow.test.ts («a missing TOTP is refused»).
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { VALKEY } from "../../src/infra/tokens.js";
import { AccountsService } from "../../src/modules/identity/accounts.service.js";
import { bootApi, expectStatus, newDevice, testConfig, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;

let api: TestApi;
let close: () => Promise<void>;

const resetEmailLimit = async (address: string) =>
  void (await api.app.get<Redis>(VALKEY).del(`rl:otp:email:${api.app.get(AccountsService).emailSubject(address).slice(0, 24)}`));

beforeAll(async () => {
  ({ api, close } = await bootApi({ ...testConfig(), AUTH_DEMO_STAFF: true, AUTH_DEMO_STAFF_WITHOUT_TOTP: true }));
});

afterAll(async () => {
  await close?.();
});

describe("демо-сотрудники без TOTP (AUTH_DEMO_STAFF_WITHOUT_TOTP)", () => {
  it("вход сотрудника — «почта → код» без второго фактора; неверный код отвергается как обычно", async () => {
    await resetEmailLimit("ministry@demo.teletau.local");
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: "ministry@demo.teletau.local" } });
    expectStatus(ch, 202);

    const wrong = await api.post<Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: "9999", device: newDevice() } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("otp_invalid");

    const s = await api.post<AuthSession>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: "0000", device: newDevice() } });
    expectStatus(s, 200);
    expect(s.body.account.kind).toBe("staff");
    // ministry/fund — «поздние» роли (ADR 0023): в Me они приходят в staffRoles, а не в roles (contract.ts).
    expect(s.body.account.staffRoles).toContain("ministry");
  });
});
