// Записи произношения в контенте (поле audio у башкирских строк): ссылка на файл Wikimedia Commons и его копия
// в content/audio. Одно правило имени копии — для проверки контента (check-content.mjs) и подготовки озвучки веба
// (prepare-audio.mjs): слово из имени файла Commons («Ba-<слово>.ogg» или «LL-Q13389 (bak)-<диктор>-<слово>.wav»;
// в адресах upload.wikimedia.org пробел записан как «_»).

/** Слово и расширение записи по ссылке Commons. */
export function audioWord(url) {
  const name = decodeURIComponent(url.split("/").pop() ?? "");
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const word = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^(?:Ba|BA)-/, "")
    .replace(/^LL-Q\d+[ _]\([a-z]+\)-[^-]+-/, "");
  return { word, ext };
}

/**
 * Латиница transcription записей Lingua Libre → допустимые буквы башкирской кириллицы. «e» и «w» неоднозначны
 * (е/э, у/ү): выбор фиксирует поле audio.word_ba, таблица его только проверяет. Буквы вне таблицы не совпадают ни с чем.
 */
const LATIN_TO_BA = {
  a: "а", b: "б", d: "д", e: "еэ", f: "ф", g: "г", "ğ": "ғ", h: "һ", i: "и", "ı": "ы", k: "к", l: "л", m: "м", n: "н",
  o: "о", "ö": "ө", p: "п", q: "ҡ", r: "р", s: "с", "ś": "ҫ", "ş": "ш", t: "т", u: "у", "ü": "ү", w: "уү", y: "й",
  z: "з", "ź": "ҙ", "ə": "ә", "-": "-",
};

/** Слово записи набрано латиницей (min, məktəp), а не кириллицей. */
export const isLatinWord = (word) => /^[\p{Script=Latin}-]+$/u.test(word.normalize("NFC"));

/** Кириллическое слово — то же, что латинское слово записи, буква в букву по LATIN_TO_BA (регистр не важен). */
export function latinMatches(latin, cyrillic) {
  const a = [...latin.normalize("NFC").toLowerCase()];
  const c = [...cyrillic.normalize("NFC").toLowerCase()];
  return a.length === c.length && a.every((ch, i) => (LATIN_TO_BA[ch] ?? "").includes(c[i]));
}

/** Путь копии записи от корня репозитория: content/audio/<слово>.<расширение>. */
export function audioCopyPath(url) {
  const { word, ext } = audioWord(url);
  return `content/audio/${word}.${ext}`;
}

/**
 * Копия в Ogg на сайте: оригинал Ogg с Commons (ogg, oga — Vorbis) копируется как есть, запись в другом формате
 * (WAV Lingua Libre) кодируется в Ogg Opus. То же правило — у импорта курса (content-import.ts, audioOggType).
 */
export const isOggOriginal = (copy) => /\.(ogg|oga)$/i.test(copy);

/** Все ссылки audio.url в разобранном YAML (любая вложенность). */
export function audioUrls(data, out = new Set()) {
  if (Array.isArray(data)) for (const x of data) audioUrls(x, out);
  else if (data && typeof data === "object") {
    if (data.audio && typeof data.audio === "object" && typeof data.audio.url === "string") out.add(data.audio.url);
    for (const v of Object.values(data)) audioUrls(v, out);
  }
  return out;
}
