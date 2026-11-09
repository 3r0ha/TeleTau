// Управляющие символы во вводе. U+0000 Postgres не принимает ни в text, ни в jsonb (SQLSTATE 22021,
// 22P05) — без проверки он давал 500, а запрос успевал что-то израсходовать (код из письма). Прочие управляющие
// символы C0, DEL и C1 в тексте для людей и в идентификаторах тоже не нужны. Табуляция и переводы строк допустимы —
// ими пишут многострочный текст (причина отказа модератора); однострочные поля для людей (ФИО, должность) отклоняют
// и их — common/text.ts.

export const CONTROL_CHARS_DETAIL = "Недопустимые управляющие символы";

/** Табуляция, перевод строки, возврат каретки — допустимы в многострочном тексте. */
const LINE_BREAKS = new Set([0x09, 0x0a, 0x0d]);

/** C0 (U+0000–U+001F) кроме \t \n \r, DEL (U+007F) и C1 (U+0080–U+009F); `singleLine` — и \t \n \r тоже. */
export function hasControlChars(s: string, options: { singleLine?: boolean } = {}): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c <= 0x1f || (c >= 0x7f && c <= 0x9f)) && (options.singleLine || !LINE_BREAKS.has(c))) return true;
  }
  return false;
}

/** Экранирование сегмента JSON Pointer (RFC 6901). */
const segment = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * JSON Pointer первой строки (значения или ключа объекта) с управляющим символом внутри `value`, иначе undefined.
 * `base` — указатель самого `value` («» для тела, `#/query` и т. п.). Обход без рекурсии: глубина JSON не ограничена.
 */
export function findControlChars(value: unknown, base = ""): string | undefined {
  const stack: Array<[unknown, string]> = [[value, base]];
  while (stack.length > 0) {
    const [node, pointer] = stack.pop()!;
    if (typeof node === "string") {
      if (hasControlChars(node)) return pointer || "/";
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push([node[i], `${pointer}/${i}`]);
    } else if (node !== null && typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, child] = entries[i]!;
        const childPointer = `${pointer}/${segment(key)}`;
        if (hasControlChars(key)) return childPointer;
        stack.push([child, childPointer]);
      }
    }
  }
  return undefined;
}
