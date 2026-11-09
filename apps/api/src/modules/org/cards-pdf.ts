// PDF карточек и бланка согласия (ADR 0018): pdfkit + qrcode + встроенный Golos Text (OFL, packages/design-tokens/fonts).
// A4, 8 карточек (2 × 4) с линиями реза, затем страница бланка согласия. ПДн нет: номер места, класс, школа, QR
// и пустая строка «Имя» (вписывает учитель). Цвета не задаются (печать — чёрным по умолчанию), поэтому токены не нужны.
// В QR — только полезная нагрузка `TT1.…`, без ссылки (ADR 0016 §2): системная камера телефона не откроет
// браузер с секретом, и он не попадёт в историю общего планшета. Адрес сайта и шаги входа напечатаны текстом.
import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const require = createRequire(import.meta.url);
const FONT_REGULAR = require.resolve("@teletau/design-tokens/fonts/golos-text/GolosText-Regular.ttf");
const FONT_BOLD = require.resolve("@teletau/design-tokens/fonts/golos-text/GolosText-Bold.ttf");

const mm = (v: number) => (v * 72) / 25.4;
export const A4 = { w: 595.28, h: 841.89 };
const COLS = 2;
const ROWS = 4;
export const CARDS_PER_PAGE = COLS * ROWS;
export const CARD = { w: A4.w / COLS, h: A4.h / ROWS };
/** Сторона QR на бумаге: не меньше 30 мм (ADR 0018). В QR ~42 символа нагрузки — версия 3, модуль ≈ 0,9 мм. */
export const QR_SIDE_MM = 34;
/** Размер шагов входа на карточке: 7,5 pt — мелко для ребёнка. */
export const STEPS_FONT_PT = 9;

export interface PdfCard {
  seatNumber: number;
  /** Полезная нагрузка для QR: `TT1.<seat>.<secret>.<check>` — без ссылки. */
  payload: string;
}

export interface CardsPdfInput {
  classTitle: string;
  schoolName: string;
  /** Адрес сайта для шага «Открой сайт …» — без протокола и без секрета (`teletau.study`, `localhost:3000`). */
  siteAddress: string;
  cards: PdfCard[];
  consent?: { title: string; version: string; body: string[] };
  now?: Date;
}

export const seatLabel = (n: number) => `№${String(n).padStart(2, "0")}`;

/** Адрес сайта для печати: хост и путь из PUBLIC_WEB_URL, без протокола и завершающей косой черты. */
export function siteAddress(publicWebUrl: string): string {
  const u = new URL(publicWebUrl);
  return `${u.host}${u.pathname}`.replace(/\/+$/, "");
}

/** Шаги входа на карточке — те же подписи, что на экранах веба («У меня есть карточка или код», «Сканировать карточку»). */
export const cardSteps = (site: string): string[] => [
  `1. Открой сайт ${site}`,
  "2. Нажми «У меня есть карточка или код»",
  "3. «Сканировать карточку» — наведи на этот QR-код",
];

function drawCutLines(doc: PDFKit.PDFDocument): void {
  doc.save().lineWidth(0.4).dash(3, { space: 3 });
  for (let c = 1; c < COLS; c++) doc.moveTo(c * CARD.w, 0).lineTo(c * CARD.w, A4.h).stroke();
  for (let r = 1; r < ROWS; r++) doc.moveTo(0, r * CARD.h).lineTo(A4.w, r * CARD.h).stroke();
  doc.undash().restore();
}

/** Фирменный ч/б элемент — контур соты (шестиугольник «остриём вверх»), как аватары и плитки интерфейса. */
function drawHoneycomb(doc: PDFKit.PDFDocument, cx: number, cy: number, r: number): void {
  const points = [0, 1, 2, 3, 4, 5].map((i): [number, number] => {
    const a = ((60 * i - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  doc.save().lineWidth(0.9).polygon(...points).stroke().restore();
}

async function drawCard(doc: PDFKit.PDFDocument, input: CardsPdfInput, card: PdfCard, x: number, y: number): Promise<void> {
  const pad = mm(6);
  const qr = await QRCode.toBuffer(card.payload, { errorCorrectionLevel: "M", margin: 4, width: 400, type: "png" });
  drawHoneycomb(doc, x + pad + mm(2), y + mm(6.3), mm(2.1));
  doc.font("Golos").fontSize(8).text(`ТелеТау · ${input.schoolName}`, x + pad + mm(5.5), y + mm(5), {
    width: CARD.w - 2 * pad - mm(5.5),
    height: 10,
    ellipsis: true,
    lineBreak: false,
  });
  doc.image(qr, x + pad, y + mm(10.5), { width: mm(QR_SIDE_MM), height: mm(QR_SIDE_MM) });
  const colX = x + pad + mm(QR_SIDE_MM) + mm(5);
  const colW = CARD.w - (colX - x) - pad;
  doc.font("Golos-Bold").fontSize(12).text(`Класс ${input.classTitle}`, colX, y + mm(12.5), { width: colW, height: 16, ellipsis: true, lineBreak: false });
  doc.font("Golos-Bold").fontSize(32).text(seatLabel(card.seatNumber), colX, y + mm(18), { width: colW, lineBreak: false });
  doc.save().lineWidth(0.8).moveTo(colX, y + mm(38.5)).lineTo(colX + colW, y + mm(38.5)).stroke().restore();
  doc.font("Golos").fontSize(8).text("Имя", colX, y + mm(40), { width: colW, lineBreak: false });

  const textW = CARD.w - 2 * pad;
  let ty = y + mm(46.5);
  doc.font("Golos-Bold").fontSize(STEPS_FONT_PT).text("Как войти:", x + pad, ty, { width: textW, lineBreak: false });
  ty += STEPS_FONT_PT * 1.3;
  for (const step of cardSteps(input.siteAddress)) {
    doc.font("Golos").fontSize(STEPS_FONT_PT).text(step, x + pad, ty, { width: textW, height: STEPS_FONT_PT * 1.3, ellipsis: true, lineBreak: false });
    ty += STEPS_FONT_PT * 1.3;
  }
  doc.font("Golos").fontSize(7.5).text("Не показывай карточку другим ребятам.", x + pad, ty + mm(0.8), { width: textW, lineBreak: false });
}

function drawConsent(doc: PDFKit.PDFDocument, input: CardsPdfInput): void {
  const consent = input.consent!;
  const m = mm(20);
  const w = A4.w - 2 * m;
  doc.font("Golos-Bold").fontSize(16).text(consent.title, m, m, { width: w });
  doc.moveDown(0.3).font("Golos").fontSize(9).text(`Для родителей · версия ${consent.version}`, { width: w });
  doc.moveDown(1);
  for (const p of consent.body) doc.font("Golos").fontSize(11).text(p, { width: w, lineGap: 2 }).moveDown(0.6);
  doc.moveDown(1).font("Golos").fontSize(11);
  doc.text(`Класс: ${input.classTitle}    Школа: ${input.schoolName}`, { width: w });
  doc.moveDown(1.2).text("Номер места ученика (с карточки): ________", { width: w });
  doc.moveDown(1.2).text("ФИО родителя (законного представителя): ______________________________________", { width: w });
  doc.moveDown(1.2).text("Подпись: ____________________        Дата: ____________________", { width: w });
  doc
    .moveDown(2)
    .fontSize(9)
    .text("Бланк хранится в школе и в систему не вносится.", { width: w });
}

/** PDF целиком в памяти: 24 карточки — меньше секунды и меньше 1 МБ (ADR 0018). */
export async function renderCardsPdf(input: CardsPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    info: { Title: `ТелеТау — карточки ${input.classTitle}`, CreationDate: input.now ?? new Date() },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont("Golos", FONT_REGULAR);
  doc.registerFont("Golos-Bold", FONT_BOLD);
  for (let i = 0; i < input.cards.length; i++) {
    if (i % CARDS_PER_PAGE === 0) {
      doc.addPage({ size: "A4", margin: 0 });
      drawCutLines(doc);
    }
    const slot = i % CARDS_PER_PAGE;
    await drawCard(doc, input, input.cards[i]!, (slot % COLS) * CARD.w, Math.floor(slot / COLS) * CARD.h);
  }
  if (input.consent) {
    doc.addPage({ size: "A4", margin: 0 });
    drawConsent(doc, input);
  }
  doc.end();
  return done;
}
