// Защита на входе и выходе шлюза (docs/04-ai-gigachat.md §5.1, §5.2, §5.5): очистка ПДн и изоляция ввода ученика
// до сборки промпта; фильтр ответа модели — ссылки, контакты и просьбы сообщить личные данные отбрасываются.

/** Адрес почты (латиница и кириллица в имени и домене). */
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
/** Кандидат в телефон: цифры с пробелами, скобками, точками и дефисами; телефоном считается от 10 цифр. */
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;
const PHONE_MIN_DIGITS = 10;

const isPhone = (candidate: string) => candidate.replace(/\D/g, "").length >= PHONE_MIN_DIGITS;

/** Управляющие символы C0, DEL и C1 (в том числе U+0085) и разделители строк U+2028, U+2029. */
const isLineBreaker = (c: number) => c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
/** Кавычки-ёлочки, лапки и их варианты: во вводе ученика они не должны закрывать или открывать цитаты промпта. */
const QUOTES_RE = /[«»‹›„‚“”‘’‟❝❞〝〞〟＂]/g;

export const EMAIL_PLACEHOLDER = "[почта]";
export const PHONE_PLACEHOLDER = "[телефон]";

/** Почта и телефоны → плейсхолдеры. Короткие числа (номера заданий, годы) не меняются. */
export function scrubPii(text: string): string {
  return text.replace(EMAIL_RE, EMAIL_PLACEHOLDER).replace(PHONE_RE, (m) => (isPhone(m) ? PHONE_PLACEHOLDER : m));
}

/** Одна строка: управляющие символы и переводы строк → пробел, пробелы схлопнуты. */
export function singleLine(text: string): string {
  let out = "";
  for (const ch of text) out += isLineBreaker(ch.charCodeAt(0)) ? " " : ch;
  return out.replace(/\s+/gu, " ").trim();
}

/** Строка контента для промпта: одна строка без ПДн. */
export function contentLine(text: string): string {
  return scrubPii(singleLine(text));
}

/**
 * Ввод ученика для блока LEARNER_INPUT: одна строка без кавычек-ёлочек и ПДн, затем JSON-строка — переводы строк
 * и кавычки не создают поддельных блоков и цитат. Пустой после очистки ввод — undefined (блок не выводится).
 */
export function learnerInput(text: string): string | undefined {
  const clean = scrubPii(singleLine(text.replace(QUOTES_RE, "")));
  return clean ? JSON.stringify(clean) : undefined;
}

// ── фильтр ответа модели ──

const URL_PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\//iu,
  /\bwww\./iu,
  /\bt\.me\//iu,
  // Домен латиницей: метка, точка, зона из 2+ букв (x.ru, site.com/path). Кириллические «т.е.», «и т.д.» не совпадают.
  /(?<![\p{L}\p{N}@.-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}@.-])[\p{L}\p{N}-]+\.(?:рф|рус|дети|москва)(?![\p{L}\p{N}])/iu,
];

/** @ник (Telegram, соцсети). */
const HANDLE_RE = /(?<![\p{L}\p{N}_])@[a-z0-9_]{3,}/iu;

const ASK = "введи|введите|вводи|напиши|напишите|пришли|пришлите|присылай|отправь|отправьте|сообщи|сообщите|скажи|скажите|укажи|укажите|назови|назовите|оставь|оставьте|продиктуй|поделись|поделитесь|скинь|скиньте";
const PERSONAL = "парол|телефон|номер|почт|e-?mail|имейл|адрес|имя|имени|фамили|отчеств|паспорт|карт[уыаой]|данн|логин|код|возраст|фото|селфи|рождени|школ|класс|город|улиц";
/** Просьба сообщить личные данные: глагол-просьба и в пределах фразы — что-то личное. */
const ASK_PERSONAL_RE = new RegExp(`(?<!\\p{L})(?:${ASK})(?!\\p{L})[^.!?]{0,60}?(?<!\\p{L})(?:${PERSONAL})`, "iu");
/** «твой/свой пароль», «твою почту», «свой номер телефона». */
const OWN_PERSONAL_RE = /(?<!\p{L})(?:тво|сво)(?:й|я|ю|е|ё|его|ей|им|ими|их)\s+(?:\p{L}+\s+)?(?:парол|телефон|номер|почт|e-?mail|адрес|фамили|паспорт|логин|данн)/iu;

export type UnsafeKind = "link" | "email" | "phone" | "handle" | "personal_data_request";

/** Первая найденная причина, по которой ответ модели нельзя показать ребёнку, или undefined. */
export function unsafeOutput(text: string): UnsafeKind | undefined {
  if (new RegExp(EMAIL_RE.source, "u").test(text)) return "email";
  if (URL_PATTERNS.some((re) => re.test(text))) return "link";
  for (const m of text.matchAll(PHONE_RE)) if (isPhone(m[0])) return "phone";
  if (HANDLE_RE.test(text)) return "handle";
  if (ASK_PERSONAL_RE.test(text) || OWN_PERSONAL_RE.test(text)) return "personal_data_request";
  return undefined;
}
