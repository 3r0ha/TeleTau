// Файлы для скачивания в браузере — общие для веба (отчёт учителя) и консоли (словарь для Фонда).
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

/** Сохранить текст файлом (blob и временная ссылка). */
export function saveTextFile(name: string, text: string, type = "text/csv;charset=utf-8"): void {
  const href = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
