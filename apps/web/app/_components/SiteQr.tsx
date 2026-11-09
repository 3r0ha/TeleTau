"use client";

import { useMemo } from "react";
import QRCode from "qrcode";

/** Тихая зона вокруг QR — 4 модуля (ISO/IEC 18004): без неё камера телефона код не находит. */
const QUIET = 4;

/** Тёмные модули QR одной строкой SVG-пути: подряд идущие модули строки — один прямоугольник. */
function qrPath(text: string): { size: number; d: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; ) {
      if (!modules.get(y, x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < n && modules.get(y, x)) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  return { size: n, d };
}

/**
 * QR-код со ссылкой: системная камера телефона откроет её без приложения. Только адрес — никаких секретов.
 * SVG без атрибутов style (строгая CSP), цвета — из токенов через классы: тёмные модули text.onFill на
 * highlight — одинаково в светлой и тёмной теме (камеры не читают «негатив»). label — текстовая альтернатива.
 */
export function SiteQr({ url, label, className }: { url: string; label: string; className?: string }) {
  const { size, d } = useMemo(() => qrPath(url), [url]);
  const box = size + QUIET * 2;
  return (
    <svg
      className={["site-qr", className].filter(Boolean).join(" ")}
      viewBox={`${-QUIET} ${-QUIET} ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-url={url}
    >
      <rect className="site-qr__bg" x={-QUIET} y={-QUIET} width={box} height={box} />
      <path className="site-qr__dark" d={d} />
    </svg>
  );
}
