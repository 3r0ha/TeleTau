/**
 * Скруглённый шестиугольник с плоским верхом, вписанный в прямоугольник w×h (как узлы тропы прототипа v2).
 * Возвращает атрибут `d` для SVG `<path>`. r — радиус скругления углов, ox/oy — смещение.
 */
export function hexPath(w: number, h: number, r: number, ox = 0, oy = 0): string {
  const points: [number, number][] = [
    [w * 0.25, 0],
    [w * 0.75, 0],
    [w, h / 2],
    [w * 0.75, h],
    [w * 0.25, h],
    [0, h / 2],
  ].map(([x, y]) => [x! + ox, y! + oy]);
  const toward = (a: [number, number], b: [number, number]): [number, number] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    return [a[0] + (dx / len) * r, a[1] + (dy / len) * r];
  };
  let d = "";
  points.forEach((v, i) => {
    const a = toward(v, points[(i + 5) % 6]!);
    const b = toward(v, points[(i + 1) % 6]!);
    d += `${i ? "L" : "M"}${a[0].toFixed(1)},${a[1].toFixed(1)}Q${v[0].toFixed(1)},${v[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
  });
  return `${d}Z`;
}
