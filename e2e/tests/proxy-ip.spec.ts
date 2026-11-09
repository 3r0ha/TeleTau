// Вход по QR идёт через BFF Next.js (/api/session/qr), и API видит соединение от сервера Next. Лимит
// «20 неверных попыток QR с одного IP за минуту» (критерий приёмки 5) должен считаться по IP ученика: BFF передаёт его
// в X-Forwarded-For, а API доверяет заголовку только от адресов из TRUST_PROXY (в dev — loopback, .env.example).
// Иначе опечатки одного ученика заблокировали бы вход всему классу. Проверка всей цепочки браузер → Next → API.
// Присланный клиентом X-Forwarded-For BFF не пересылает — IP берётся из адреса сокета, а за доверенным
// балансировщиком (BFF_TRUST_PROXY; здесь его роль играет сам тест на loopback, playwright.config.ts) — тот адрес,
// который балансировщик дописал справа. Подставленный клиентом левый адрес отдельного счётчика не даёт.
import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import { generateQrCard } from "@teletau/auth-codes";
import { stack } from "../support/env.js";

/** Адрес из диапазона для тестов сетей (RFC 2544): у каждого прогона — свои «ученики». */
const testIp = () => `198.18.${randomInt(256)}.${randomInt(1, 255)}`;

test("лимит неверных попыток QR считается по IP ученика за балансировщиком, подмена X-Forwarded-For его не обходит", async ({ request }) => {
  const { webUrl } = stack();
  const studentA = testIp();
  let studentB = testIp();
  while (studentB === studentA) studentB = testIp();
  // Каждая попытка — новая несуществующая карточка: лимит на одну карточку (10 за 10 минут) не мешает лимиту по IP.
  const attempt = (forwardedFor: string) =>
    request.post(`${webUrl}/api/session/qr`, {
      headers: { origin: webUrl, "x-forwarded-for": forwardedFor },
      data: { payload: generateQrCard().payload },
    });

  for (let i = 1; i <= 20; i++) {
    const res = await attempt(studentA);
    expect(res.status(), `попытка ${i}`).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("card_invalid");
  }
  const blocked = await attempt(studentA);
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);

  // Ученик A подставил «новый» адрес слева — балансировщик дописал справа настоящий: счётчик тот же.
  const spoofed = await attempt(`${testIp()}, ${studentA}`);
  expect(spoofed.status()).toBe(429);

  // Другой ученик за тем же сервером Next не заблокирован.
  const other = await attempt(studentB);
  expect(other.status()).toBe(401);
  expect(((await other.json()) as { code: string }).code).toBe("card_invalid");
});
