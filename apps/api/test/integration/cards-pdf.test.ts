// Полный разбор PDF карточек (ADR 0018 §6): pdfjs-dist достаёт картинки и тексты, jsQR декодирует
// каждый QR. В интеграционном проекте — тяжёлый разбор с запасом по времени, без зависимости от нагрузки юнит-прогона.
// БД и Valkey не нужны: проверяется только рендер.
import { generateQrCard, parseQrPayload } from "@teletau/auth-codes";
import { describe, expect, it } from "vitest";
import { A4, CARD, CARDS_PER_PAGE, cardSteps, renderCardsPdf, STEPS_FONT_PT } from "../../src/modules/org/cards-pdf.js";
import { scanPdf } from "../support/pdf-qr.js";

describe("cards PDF, full parse (ADR 0018, M1-02)", () => {
  it("24 cards → 3 card pages + consent page; every QR decodes to the bare payload; site address and steps are printed", async () => {
    const cards = Array.from({ length: 24 }, (_, i) => ({ seatNumber: i + 1, payload: generateQrCard().payload }));
    const pdf = await renderCardsPdf({
      classTitle: "5 «Б»",
      schoolName: "Демо-школа № 1",
      siteAddress: "localhost:3000",
      cards,
      consent: { title: "Согласие родителя", version: "2026-11-01", body: ["Текст бланка."] },
    });
    const scan = await scanPdf(pdf);
    expect(scan.pages).toBe(24 / CARDS_PER_PAGE + 1);
    expect(scan.qr.slice(0, 3).map((p) => p.length)).toEqual([8, 8, 8]);
    expect(scan.qr[3]).toEqual([]);
    const decoded = scan.qr.flat();
    // В QR — сама полезная нагрузка: системная камера не откроет по ней браузер, секрет не попадёт в историю.
    expect(decoded).toEqual(cards.map((c) => c.payload));
    for (const text of decoded) {
      expect(text).not.toMatch(/https?:|\/q#|localhost/);
      expect(parseQrPayload(text).ok).toBe(true);
    }
    // Подписи карточки и бланка; адрес сайта и шаги входа; секрета текстом на карточке нет; автора в метаданных нет.
    expect(scan.text[0]).toContain("Имя");
    expect(scan.text[0]).toContain("№07");
    expect(scan.text[0]).toContain("Класс 5 «Б»");
    expect(scan.text[0]).toContain("Как войти:");
    for (const step of cardSteps("localhost:3000")) expect(scan.text[0]).toContain(step);
    expect(scan.text[3]).toContain("ФИО родителя");
    expect(scan.text[3]).toContain("2026-11-01");
    expect(scan.text.join(" ")).not.toContain(cards[0]!.payload.split(".")[2]);
    expect(scan.title).toBe("ТелеТау — карточки 5 «Б»");
    expect(scan.author).toBeUndefined();
  }, 60_000);

  it("keeps every line of a card inside its cell (no overflow over the cut lines), steps at ≥ 9 pt", async () => {
    const pdf = await renderCardsPdf({
      classTitle: "11 «ӘБВ»",
      schoolName: "Муниципальное бюджетное общеобразовательное учреждение средняя общеобразовательная школа № 1 с длинным названием",
      siteAddress: "teletau.bashkortostan.example",
      cards: Array.from({ length: 8 }, (_, i) => ({ seatNumber: 92 + i, payload: generateQrCard().payload })),
    });
    const scan = await scanPdf(pdf);
    expect(scan.pages).toBe(1);
    const margin = 2; // pt: текст не касается линии реза
    for (const it of scan.items[0]!) {
      const col = Math.floor(it.x / CARD.w);
      const row = Math.floor((A4.h - it.y) / CARD.h);
      const cell = { left: col * CARD.w, right: (col + 1) * CARD.w, top: A4.h - row * CARD.h, bottom: A4.h - (row + 1) * CARD.h };
      expect(it.x, it.str).toBeGreaterThan(cell.left + margin);
      expect(it.x + it.width, it.str).toBeLessThan(cell.right - margin);
      expect(it.y, it.str).toBeGreaterThan(cell.bottom + margin);
      expect(it.y + it.height, it.str).toBeLessThan(cell.top - margin);
    }
    const steps = scan.items[0]!.filter((i) => /^[123]\. /.test(i.str));
    expect(steps).toHaveLength(8 * 3);
    for (const s of steps) expect(s.height).toBeGreaterThanOrEqual(STEPS_FONT_PT - 0.01);
  }, 60_000);
});
