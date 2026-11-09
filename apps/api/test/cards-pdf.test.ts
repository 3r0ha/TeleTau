// Лёгкая проверка PDF карточек (ADR 0018): рендер, число страниц, размер, адрес сайта и QR без ссылки.
// Тяжёлый разбор (pdfjs-dist + jsQR: каждый QR, тексты, раскладка) — в интеграционном проекте
// (test/integration/cards-pdf.test.ts), чтобы юнит-прогон не зависел от нагрузки на машину.
import { generateQrCard, parseQrPayload } from "@teletau/auth-codes";
import QRCode from "qrcode";
import { describe, expect, it, vi } from "vitest";
import { cardSteps, renderCardsPdf, siteAddress } from "../src/modules/org/cards-pdf.js";

describe("cards PDF (ADR 0018, M1-02)", () => {
  it(
    "renders 24 cards on 3 pages + the consent page, under 1 MB; QR content is the bare TT1 payload, not a link",
    async () => {
      const encoded: string[] = [];
      const real = QRCode.toBuffer.bind(QRCode) as (text: string, options: object) => Promise<Buffer>;
      // Перехват содержимого QR: что именно кодируется в картинку (сама картинка разбирается в интеграционном тесте).
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- у toBuffer есть перегрузка с колбэком (void), здесь — промис
      const spy = vi.spyOn(QRCode, "toBuffer").mockImplementation(((text: string, options: object) => {
        encoded.push(text);
        return real(text, options);
      }) as unknown as typeof QRCode.toBuffer);
      try {
        const cards = Array.from({ length: 24 }, (_, i) => ({ seatNumber: i + 1, payload: generateQrCard().payload }));
        const pdf = await renderCardsPdf({
          classTitle: "5 «Б»",
          schoolName: "Демо-школа № 1",
          siteAddress: "teletau.example",
          cards,
          consent: { title: "Согласие родителя", version: "2026-11-01", body: ["Текст бланка."] },
        });
        expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
        expect(pdf.length).toBeLessThan(1024 * 1024);
        expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(4);
        expect(encoded).toEqual(cards.map((c) => c.payload));
        for (const text of encoded) {
          expect(text).toMatch(/^TT1\./);
          expect(text).not.toMatch(/https?:|\/q#/);
          expect(parseQrPayload(text).ok).toBe(true);
        }
      } finally {
        spy.mockRestore();
      }
    },
    20_000,
  );

  it("prints the site address without protocol and secret, and the login steps of the web screens", () => {
    expect(siteAddress("https://teletau.study")).toBe("teletau.study");
    expect(siteAddress("http://localhost:3000/")).toBe("localhost:3000");
    expect(siteAddress("https://school.example/teletau/")).toBe("school.example/teletau");
    expect(cardSteps("teletau.study")).toEqual([
      "1. Открой сайт teletau.study",
      "2. Нажми «У меня есть карточка или код»",
      "3. «Сканировать карточку» — наведи на этот QR-код",
    ]);
  });
});
