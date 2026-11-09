// Проверка PDF без canvas (ADR 0018 §6): pdfjs-dist достаёт картинки страниц, jsQR декодирует каждый QR.
import jsQRModule from "jsqr";
import { getDocument, ImageKind, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfScan {
  pages: number;
  /** Текст в QR по страницам (порядок рисования). */
  qr: string[][];
  /** Весь текст страниц — для проверки подписей и отсутствия ПДн. */
  text: string[];
  /** Текстовые фрагменты страниц с положением (PDF-координаты, начало — левый нижний угол) — для проверки раскладки. */
  items: Array<Array<{ str: string; x: number; y: number; width: number; height: number }>>;
  title?: string;
  author?: string;
}

/** jsqr — CommonJS с `exports.default`: в зависимости от загрузчика по умолчанию приходит функция или объект модуля. */
type JsQr = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
const jsQR: JsQr = ((jsQRModule as unknown as { default?: JsQr }).default ?? jsQRModule) as unknown as JsQr;

interface PdfImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8ClampedArray | Uint8Array;
}

function toRgba(img: PdfImage): Uint8ClampedArray {
  if (img.kind === ImageKind.RGBA_32BPP) return new Uint8ClampedArray(img.data);
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  if (img.kind === ImageKind.RGB_24BPP) {
    for (let i = 0, j = 0; i < img.width * img.height; i++, j += 3) {
      out[i * 4] = img.data[j]!;
      out[i * 4 + 1] = img.data[j + 1]!;
      out[i * 4 + 2] = img.data[j + 2]!;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  // GRAYSCALE_1BPP: строки, выровненные по байту, 1 — белый.
  const rowBytes = (img.width + 7) >> 3;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const bit = (img.data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
      const v = bit ? 255 : 0;
      const o = (y * img.width + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}

export async function scanPdf(pdf: Uint8Array): Promise<PdfScan> {
  const task = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const meta = await doc.getMetadata();
  const info = meta.info as { Title?: string; Author?: string };
  const qr: string[][] = [];
  const text: string[] = [];
  const items: PdfScan["items"] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const ops = await page.getOperatorList();
    const found: string[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
      const id = (ops.argsArray[i] as [string])[0];
      const img = await new Promise<PdfImage>((resolve) => page.objs.get(id, (v: unknown) => resolve(v as PdfImage)));
      const code = jsQR(toRgba(img), img.width, img.height);
      if (code) found.push(code.data);
    }
    qr.push(found);
    const content = await page.getTextContent();
    text.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    items.push(
      content.items.flatMap((it) =>
        "str" in it && it.str.trim() ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, width: it.width, height: it.height }] : [],
      ),
    );
  }
  const pages = doc.numPages;
  await task.destroy();
  return { pages, qr, text, items, ...(info.Title ? { title: info.Title } : {}), ...(info.Author ? { author: info.Author } : {}) };
}
