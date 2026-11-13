// CSV публичного словаря (GET /public/dictionary?format=csv): та же логика, что csvCell/csvTable в
// packages/ui/src/files.ts, но @teletau/ui — браузерная либа, её в API не импортируют.
// Excel в русской локали открывает CSV с разделителем «;» и BOM UTF-8 без мастера импорта.

/** Ячейка CSV: кавычки при «;», кавычках и переводах строк; формулы (=, +, -, @) не исполняются в Excel. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Таблица CSV: строки ячеек → текст с BOM, разделитель «;», перевод строки CRLF. */
export function csvTable(rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
