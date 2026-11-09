// Проверка демо-контента (scripts/check-content.mjs) ловит двойник вместо башкирской буквы и ссылку на неизвестный источник.
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkContent } from "../check-content.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(REPO, "packages/bashkir-text/dist");
const skip = existsSync(join(DIST, "index.js"))
  ? false
  : "нужна сборка: pnpm --filter @teletau/bashkir-text build";

const ba = (text, ref = "src") => ({
  ba: text,
  source: { ref, url: "https://example.org/a", locator: "строка 1" },
  review: "needs_native_review",
});
const choice = (id, prompt) => ({
  id,
  type: "choice_ba_ru",
  prompt,
  options_ru: ["да", "нет"],
  correct: 0,
});
const json = (v) => JSON.stringify(v, null, 2); // JSON — подмножество YAML

/** Минимальный корень репозитория: схемы, собранный bashkir-text, один курс с одним уроком, очередь проверки. */
function fixture(prompts, extraFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), "teletau-content-"));
  const put = (p, s) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), s);
  };
  cpSync(join(REPO, "content/schema"), join(root, "content/schema"), { recursive: true });
  mkdirSync(join(root, "packages/bashkir-text"), { recursive: true });
  symlinkSync(DIST, join(root, "packages/bashkir-text/dist"), "dir");
  put(
    "content/sources.yaml",
    json({
      sources: [
        {
          id: "src",
          title: "Тест",
          url: "https://example.org/",
          license: "CC BY 4.0",
          accessed: "2026-11-04",
        },
      ],
    }),
  );
  put(
    "content/course/c/course.yaml",
    json({ id: "c", version: 1, title_ru: "Курс", direction: "ru-ba", units: ["u"] }),
  );
  put(
    "content/course/c/units/u/unit.yaml",
    json({
      id: "u",
      order: 1,
      status: "open",
      place: { slug: "p", title_ru: "Место" },
      topic_ru: "Тема",
      nodes: [{ id: "l", kind: "lesson" }],
    }),
  );
  put(
    "content/course/c/units/u/lessons/l.yaml",
    json({
      id: "l",
      unit: "u",
      kind: "lesson",
      title_ru: "Урок",
      exercises: prompts.map((p, i) => choice(`l-e${i}`, p)),
    }),
  );
  put(
    "docs/native-review-queue.md",
    "| # | Где |\n|---|---|\n| 1 | `content/course/c/units/u/lessons/l.yaml` |\n",
  );
  for (const [p, body] of Object.entries(extraFiles)) put(p, body);
  return root;
}

async function errorsFor(prompts, extraFiles) {
  const root = fixture(prompts, extraFiles);
  try {
    return (await checkContent(root)).errors;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("clean fixture passes", { skip }, async () => {
  assert.deepEqual(await errorsFor([ba("Эйе."), ba("Юҡ."), ba("Рәхмәт!")]), []);
});

test(
  "a lookalike code point in ba is an error (Kazakh қ U+049B instead of ҡ U+04A1)",
  { skip },
  async () => {
    const errors = await errorsFor([ba("Эйе."), ba("Юқ."), ba("Рәхмәт!")]);
    assert.ok(
      errors.some((e) => e.includes("U+049B")),
      errors.join("\n"),
    );
    assert.ok(
      errors.some((e) => e.includes("normalize(ba)")),
      errors.join("\n"),
    );
  },
);

test("a source.ref missing from sources.yaml is an error", { skip }, async () => {
  const errors = await errorsFor([ba("Эйе."), ba("Юҡ.", "no-such-source"), ba("Рәхмәт!")]);
  assert.ok(
    errors.some((e) => e.includes("«no-such-source» нет в content/sources.yaml")),
    errors.join("\n"),
  );
});

const audio = (word) => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/a/a0/Ba-${encodeURIComponent(word)}.ogg`,
  source: { ref: "src", url: "https://commons.wikimedia.org/wiki/File:x", locator: "файл" },
});

test("a recording of this very word with a local copy passes", { skip }, async () => {
  const errors = await errorsFor(
    [{ ...ba("бер"), audio: audio("бер") }, ba("Юҡ."), ba("Рәхмәт!")],
    {
      "content/audio/бер.ogg": "ogg",
    },
  );
  assert.deepEqual(errors, []);
});

test(
  "a recording of another word and an unreferenced audio file are errors",
  { skip },
  async () => {
    const errors = await errorsFor(
      [{ ...ba("Юҡ."), audio: audio("бер") }, ba("Эйе."), ba("Рәхмәт!")],
      {
        "content/audio/бер.ogg": "ogg",
        "content/audio/ике.ogg": "ogg",
      },
    );
    assert.ok(
      errors.some((e) => e.includes("запись слова «бер»")),
      errors.join("\n"),
    );
    assert.ok(
      errors.some((e) => e.includes("content/audio/ике.ogg: запись не привязана")),
      errors.join("\n"),
    );
  },
);

/** Запись Lingua Libre, слово которой в имени файла набрано латиницей. */
const latinAudio = (latin, wordBa) => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/9/9f/LL-Q13389_%28bak%29-Speaker-${encodeURIComponent(latin)}.wav`,
  source: { ref: "src", url: "https://commons.wikimedia.org/wiki/File:x", locator: "файл" },
  ...(wordBa === undefined ? {} : { word_ba: wordBa }),
});

test("a Latin-labelled recording passes when word_ba matches it letter by letter", { skip }, async () => {
  const errors = await errorsFor(
    [{ ...ba("мәктәп"), audio: latinAudio("məktəp", "мәктәп") }, { ...ba("Эт"), audio: latinAudio("et", "эт") }, ba("Рәхмәт!")],
    { "content/audio/məktəp.wav": "wav", "content/audio/et.wav": "wav" },
  );
  assert.deepEqual(errors, []);
});

test("a Latin-labelled recording needs word_ba, and word_ba must match the recording", { skip }, async () => {
  const errors = await errorsFor(
    [{ ...ba("мин"), audio: latinAudio("min") }, { ...ba("тау"), audio: latinAudio("taw", "тай") }, ba("Рәхмәт!")],
    { "content/audio/min.wav": "wav", "content/audio/taw.wav": "wav" },
  );
  assert.ok(errors.some((e) => e.includes("«min» набрано латиницей")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("audio.word_ba «тай» — не та запись")), errors.join("\n"));
});

test("word_ba is not allowed on a recording labelled in Cyrillic", { skip }, async () => {
  const errors = await errorsFor([{ ...ba("бер"), audio: { ...audio("бер"), word_ba: "бер" } }, ba("Юҡ."), ba("Рәхмәт!")], {
    "content/audio/бер.ogg": "ogg",
  });
  assert.ok(errors.some((e) => e.includes("word_ba — только для записи")), errors.join("\n"));
});
