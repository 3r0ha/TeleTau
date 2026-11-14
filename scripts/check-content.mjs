// Проверка демо-контента курса и дуэлей (docs/plans/M2.md §3 «Ч1 → Проверка»; CLAUDE.md, правила 6 и 7). Подключён в `pnpm lint`.
// 1. Схема: content/schema/*.schema.json (JSON Schema 2020-12) для sources.yaml, course.yaml, unit.yaml, уроков и дуэлей.
// 2. Кодовые точки: в поле ba — только кириллица, правильные башкирские буквы (ә U+04D9, ө U+04E9, ү U+04AF, ғ U+0493,
//    ҡ U+04A1, ң U+04A3, ҙ U+0499, ҫ U+04AB, һ U+04BB), цифры, пробел и обычная пунктуация. Двойники — только в raw.
// 3. normalize(ba) === ba (пакет @teletau/bashkir-text); если есть raw — normalize(raw) === ba и raw !== ba.
// 4. Каждая source.ref (и ru_source.ref) есть в content/sources.yaml.
// 5. Для каждого файла с башкирским текстом есть строка в docs/native-review-queue.md (путь файла в обратных кавычках).
// Плюс целостность, которую схема не выражает: id уникальны, уроки и узлы тропы совпадают, ссылки дуэлей существуют,
// new_words — точные копии строк урока, варианты дуэли различаются после toComparable, в русских полях нет башкирских букв.
// Плюс синтез озвучки (content/audio/tts/<слаг>.ogg, scripts/tts): слаг — ttsSlug(normalize(ba)) строки курса
// без записи носителя; файл-сирота или слаг строки с записью — ошибка (запись всегда предпочтительнее синтеза).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseDocument } from "yaml";
import { audioCopyPath, audioWord, isLatinWord, latinMatches, ttsSlug } from "./lib/audio.mjs";
import { isInvokedDirectly } from "./lib/invoked.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Башкирские буквы, которых нет в русском алфавите (правило 7). */
const BASHKIR_LETTERS = "ӘәӨөҮүҒғҠҡҢңҘҙҪҫҺһ";
/** Разрешённые символы в ba: русский алфавит, башкирские буквы, цифры, пробел, пунктуация. */
const BA_ALLOWED = new RegExp(`^[А-Яа-яЁё${BASHKIR_LETTERS}0-9 .,!?:;()«»"'’—–\\-…]$`, "u");
const HAS_BASHKIR_LETTER = new RegExp(`[${BASHKIR_LETTERS}]`, "u");

const cp = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
const rel = (root, p) => relative(root, p).split(sep).join("/");

async function loadBashkirText(root) {
  const dist = join(root, "packages/bashkir-text/dist/index.js");
  if (!existsSync(dist)) {
    throw new Error(
      `нет ${rel(root, dist)} — соберите пакет: pnpm --filter @teletau/bashkir-text build`,
    );
  }
  return import(pathToFileURL(dist).href);
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function readYaml(file, errors, root) {
  const doc = parseDocument(readFileSync(file, "utf8"), { uniqueKeys: true, prettyErrors: true });
  for (const e of [...doc.errors, ...doc.warnings])
    errors.push(`${rel(root, file)}: YAML: ${e.message.split("\n")[0]}`);
  return doc.errors.length ? undefined : doc.toJS();
}

function buildAjv(root) {
  // strictRequired: false — схемы content/schema пишут anyOf: [{ required: [url] }, { required: [page] }] при properties на уровне выше.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
  });
  addFormats(ajv);
  const dir = join(root, "content/schema");
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".schema.json"))
    .sort()) {
    ajv.addSchema(JSON.parse(readFileSync(join(dir, f), "utf8")));
  }
  return ajv;
}

/** Ошибки oneOf у упражнений: оставляем только ветку того же type, иначе отчёт тонет в чужих ветках. */
const BRANCH_BY_TYPE = {
  tiles_ru_ba: "TilesRuBa",
  choice_ba_ru: "ChoiceBaRu",
  free_ru_ba: "FreeRuBa",
  duel: "Duel",
  match_pairs: "MatchPairs",
};
function schemaErrors(ajv, schemaId, data, file, root) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) return [`${rel(root, file)}: нет схемы ${schemaId}`];
  if (validate(data)) return [];
  let errs = validate.errors ?? [];
  if (schemaId === "lesson.schema.json") {
    errs = errs.filter((e) => {
      const m = e.instancePath.match(/^\/exercises\/(\d+)/);
      if (!m) return true;
      const own = BRANCH_BY_TYPE[data.exercises?.[Number(m[1])]?.type];
      if (!own) return true;
      if (e.keyword === "oneOf") return false;
      const branch = e.schemaPath.match(
        /#\/\$defs\/(TilesRuBa|ChoiceBaRu|FreeRuBa|Duel|MatchPairs)\//,
      )?.[1];
      return !branch || branch === own;
    });
    if (!errs.length) errs = validate.errors ?? [];
  }
  return errs.map((e) => {
    const extra = e.params?.additionalProperty ? ` («${e.params.additionalProperty}»)` : "";
    return `${rel(root, file)}: схема: ${e.instancePath || "/"} ${e.message}${extra}`;
  });
}

/** Все объекты BaText (у них есть строковое поле ba) и все SourceRef (поле ref) — с путём внутри файла. */
function walk(node, path, visit) {
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}/${i}`, visit));
  else if (node && typeof node === "object") {
    visit(node, path);
    for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`, visit);
  }
}

const RU_KEYS = new Set(["ru", "prompt_ru", "title_ru", "topic_ru", "options_ru"]);

/**
 * Проверяет каталог content/ репозитория root. Возвращает { errors, warnings, stats }; ничего не печатает.
 * @param {string} root корень репозитория
 */
export async function checkContent(root = REPO) {
  const errors = [];
  const warnings = [];
  const stats = { files: 0, baStrings: 0, lessons: 0, exercises: 0, duels: 0, sources: 0 };
  const { normalize, toComparable, answerTokens } = await loadBashkirText(root);
  if (typeof answerTokens !== "function")
    throw new Error(
      "в packages/bashkir-text/dist нет answerTokens — пересоберите: pnpm --filter @teletau/bashkir-text build",
    );
  const ajv = buildAjv(root);
  const contentDir = join(root, "content");

  // --- источники
  const sourcesFile = join(contentDir, "sources.yaml");
  const sourceIds = new Set();
  const usedSources = new Set();
  if (!existsSync(sourcesFile)) errors.push("content/sources.yaml: файла нет");
  else {
    const data = readYaml(sourcesFile, errors, root);
    stats.files++;
    if (data) {
      errors.push(...schemaErrors(ajv, "sources.schema.json", data, sourcesFile, root));
      for (const s of data.sources ?? []) {
        if (sourceIds.has(s.id)) errors.push(`content/sources.yaml: id «${s.id}» повторяется`);
        sourceIds.add(s.id);
      }
      stats.sources = sourceIds.size;
    }
  }

  // --- раскладка файлов
  // content/schema — схемы; content/_staging — черновик сбора материала, в импорт не идёт.
  const files = listFiles(contentDir).filter(
    (f) => !/^content\/(schema|_staging)\//.test(rel(root, f)),
  );
  const courseFiles = [];
  const unitFiles = [];
  const lessonFiles = [];
  const duelFiles = [];
  const audioFiles = new Set();
  const ttsFiles = new Set();
  for (const f of files) {
    const r = rel(root, f);
    if (r === "content/sources.yaml") continue;
    if (/^content\/audio\/[^/]+\.(ogg|oga|opus|mp3|wav|flac|webm)$/.test(r)) {
      audioFiles.add(r);
      continue;
    }
    if (/^content\/audio\/tts\/[^/]+\.ogg$/.test(r)) {
      ttsFiles.add(r);
      continue;
    }
    if (/^content\/course\/[^/]+\/course\.yaml$/.test(r)) courseFiles.push(f);
    else if (/^content\/course\/[^/]+\/units\/[^/]+\/unit\.yaml$/.test(r)) unitFiles.push(f);
    else if (/^content\/course\/[^/]+\/units\/[^/]+\/lessons\/[^/]+\.yaml$/.test(r))
      lessonFiles.push(f);
    else if (/^content\/corpus\/duels\/[^/]+\.yaml$/.test(r)) duelFiles.push(f);
    else
      errors.push(
        `${r}: неизвестный файл контента (ожидаются course.yaml, unit.yaml, lessons/*.yaml, corpus/duels/*.yaml, audio/<слово>.<ogg|mp3|…>, audio/tts/<слаг>.ogg)`,
      );
  }
  if (!courseFiles.length) errors.push("content/course/*/course.yaml: ни одного курса");

  /**
   * Озвучка: файл Commons — запись именно этого слова (слово из имени файла «Ba-<слово>.ogg» или
   * «LL-Q13389 (bak)-<диктор>-<слово>.wav» совпадает с ba после answerTokens), и его копия лежит в
   * content/audio/<слово>.<расширение>. Лишних файлов в content/audio нет. Слово записи, набранное латиницей
   * (transcription Lingua Libre: min), сравнивается через audio.word_ba — кириллицу, совпадающую с ним буква в букву.
   */
  const usedAudio = new Set();
  function checkAudio(at, ba, audio) {
    const { url, word_ba: wordBa } = audio;
    const { word } = audioWord(url);
    let heard = word;
    if (wordBa !== undefined) {
      if (!isLatinWord(word))
        errors.push(`${at}: audio.word_ba — только для записи, слово которой в имени файла набрано латиницей`);
      else if (!latinMatches(word, wordBa))
        errors.push(`${at}: audio.word_ba «${wordBa}» — не та запись: в файле «${word}»`);
      heard = wordBa;
    } else if (isLatinWord(word)) {
      errors.push(`${at}: audio — слово записи «${word}» набрано латиницей: укажите его кириллицей в audio.word_ba`);
      heard = undefined;
    }
    if (heard !== undefined && answerTokens(heard).join(" ") !== answerTokens(ba).join(" "))
      errors.push(`${at}: audio — запись слова «${heard}», а не этой строки`);
    const local = audioCopyPath(url);
    if (!audioFiles.has(local)) errors.push(`${at}: audio — нет копии записи ${local}`);
    usedAudio.add(local);
  }

  /**
   * Общие проверки башкирских строк, ссылок на источники и русских полей файла. courseSlugs (только для файлов
   * курса) наполняется слагами строк без записи носителя — по ним проверяются TTS-копии content/audio/tts.
   */
  const filesWithBa = [];
  function checkStrings(file, data, courseSlugs) {
    const r = rel(root, file);
    let baCount = 0;
    walk(data, "", (obj, path) => {
      if (typeof obj.ref === "string" && ("locator" in obj || "url" in obj || "page" in obj)) {
        usedSources.add(obj.ref);
        if (!sourceIds.has(obj.ref))
          errors.push(`${r}: ${path}/ref «${obj.ref}» нет в content/sources.yaml`);
      }
      for (const [k, v] of Object.entries(obj)) {
        if (!RU_KEYS.has(k)) continue;
        for (const s of Array.isArray(v) ? v : [v]) {
          if (typeof s === "string" && HAS_BASHKIR_LETTER.test(s)) {
            errors.push(
              `${r}: ${path}/${k} «${s}» — башкирские буквы в русском поле (башкирский текст — только в ba с источником)`,
            );
          }
        }
      }
      if (typeof obj.ba !== "string") return;
      baCount++;
      const at = `${r}: ${path}/ba «${obj.ba}»`;
      const bad = [...new Set([...obj.ba].filter((ch) => !BA_ALLOWED.test(ch)))];
      if (bad.length)
        errors.push(
          `${at}: недопустимые символы ${bad.map((ch) => `«${ch}» ${cp(ch)}`).join(", ")} (двойники — в raw, в ba — normalize)`,
        );
      const n = normalize(obj.ba);
      if (n !== obj.ba) errors.push(`${at}: normalize(ba) = «${n}» ≠ ba`);
      if (obj.ba !== obj.ba.trim() || /\s{2,}/u.test(obj.ba)) errors.push(`${at}: лишние пробелы`);
      if (obj.raw !== undefined) {
        if (obj.raw === obj.ba)
          errors.push(
            `${at}: raw совпадает с ba — raw нужен, только если источник набран двойниками`,
          );
        else if (normalize(obj.raw) !== obj.ba)
          errors.push(`${at}: normalize(raw «${obj.raw}») = «${normalize(obj.raw)}» ≠ ba`);
      }
      if (obj.audio?.url) checkAudio(at, obj.ba, obj.audio);
      if (courseSlugs && obj.review !== "native_rejected") {
        const slug = ttsSlug(obj.ba);
        if (obj.audio?.url) courseSlugs.native.add(slug);
        else courseSlugs.want.add(slug);
      }
    });
    stats.baStrings += baCount;
    if (baCount) filesWithBa.push(r);
  }

  // --- дуэли
  const duelsByUnit = new Map();
  const duelIds = new Set();
  for (const f of duelFiles) {
    stats.files++;
    const data = readYaml(f, errors, root);
    if (!data) continue;
    errors.push(...schemaErrors(ajv, "duels.schema.json", data, f, root));
    checkStrings(f, data);
    const r = rel(root, f);
    if (data.unit && basename(f, ".yaml") !== data.unit)
      errors.push(`${r}: unit «${data.unit}» не совпадает с именем файла`);
    const ids = new Set();
    for (const [i, d] of (data.duels ?? []).entries()) {
      if (duelIds.has(d.id)) errors.push(`${r}: /duels/${i} id «${d.id}» повторяется в корпусе`);
      duelIds.add(d.id);
      ids.add(d.id);
      const [a, b] = d.variants ?? [];
      if (a?.ba && b?.ba && toComparable(a.ba) === toComparable(b.ba)) {
        errors.push(
          `${r}: /duels/${i} варианты «${a.ba}» и «${b.ba}» совпадают после toComparable — это не дуэль`,
        );
      }
    }
    stats.duels += ids.size;
    duelsByUnit.set(data.unit, ids);
  }

  // --- курсы, юниты, уроки
  const exerciseIds = new Set();
  const nodeIds = new Set();
  const lessonsSeen = new Set();
  const courseSlugs = { want: new Set(), native: new Set() }; // слаги строк курса без записи / с записью
  for (const cf of courseFiles) {
    stats.files++;
    const course = readYaml(cf, errors, root);
    if (!course) continue;
    errors.push(...schemaErrors(ajv, "course.schema.json", course, cf, root));
    checkStrings(cf, course, courseSlugs);
    const courseDir = dirname(cf);
    const cr = rel(root, cf);
    if (course.id && basename(courseDir) !== course.id)
      errors.push(`${cr}: id «${course.id}» не совпадает с каталогом`);
    const unitDirs = existsSync(join(courseDir, "units"))
      ? readdirSync(join(courseDir, "units")).filter((n) =>
          statSync(join(courseDir, "units", n)).isDirectory(),
        )
      : [];
    for (const d of unitDirs)
      if (!(course.units ?? []).includes(d))
        errors.push(`${cr}: юнит units/${d}/ не перечислен в units`);

    for (const [ui, unitId] of (course.units ?? []).entries()) {
      const uf = join(courseDir, "units", unitId, "unit.yaml");
      const ur = rel(root, uf);
      if (!existsSync(uf)) {
        errors.push(`${ur}: файла нет (юнит «${unitId}» перечислен в ${cr})`);
        continue;
      }
      stats.files++;
      const unit = readYaml(uf, errors, root);
      if (!unit) continue;
      errors.push(...schemaErrors(ajv, "unit.schema.json", unit, uf, root));
      checkStrings(uf, unit, courseSlugs);
      if (unit.id !== unitId) errors.push(`${ur}: id «${unit.id}» ≠ «${unitId}»`);
      if (unit.order !== ui + 1)
        errors.push(`${ur}: order ${unit.order}, а в course.units юнит стоит ${ui + 1}-м`);
      const lessonDir = join(courseDir, "units", unitId, "lessons");
      const pool = duelsByUnit.get(unitId);
      for (const [ni, node] of (unit.nodes ?? []).entries()) {
        if (nodeIds.has(node.id))
          errors.push(`${ur}: /nodes/${ni} id «${node.id}» повторяется в курсе`);
        nodeIds.add(node.id);
        if (node.kind === "help_language") {
          if (unit.status === "open" && (!pool || pool.size < (node.duels ?? 0))) {
            errors.push(
              `${ur}: /nodes/${ni} просит ${node.duels} дуэлей, а в content/corpus/duels/${unitId}.yaml их ${pool?.size ?? 0}`,
            );
          }
          continue;
        }
        if (unit.status !== "open") continue;
        const lf = join(lessonDir, `${node.id}.yaml`);
        if (!existsSync(lf))
          errors.push(`${ur}: /nodes/${ni} — нет урока ${rel(root, lf)} (юнит открыт)`);
      }
      const nodeById = new Map((unit.nodes ?? []).map((n) => [n.id, n]));

      for (const lf of lessonFiles.filter((f) => dirname(f) === lessonDir)) {
        lessonsSeen.add(lf);
        stats.files++;
        const lr = rel(root, lf);
        const lesson = readYaml(lf, errors, root);
        if (!lesson) continue;
        stats.lessons++;
        errors.push(...schemaErrors(ajv, "lesson.schema.json", lesson, lf, root));
        checkStrings(lf, lesson, courseSlugs);
        if (lesson.id !== basename(lf, ".yaml"))
          errors.push(`${lr}: id «${lesson.id}» не совпадает с именем файла`);
        if (lesson.unit !== unitId) errors.push(`${lr}: unit «${lesson.unit}» ≠ «${unitId}»`);
        const node = nodeById.get(lesson.id);
        if (!node) errors.push(`${lr}: урока нет среди узлов ${ur}`);
        else if (node.kind !== lesson.kind)
          errors.push(`${lr}: kind «${lesson.kind}», а узел тропы — «${node.kind}»`);
        if (unit.status !== "open")
          errors.push(`${lr}: юнит закрыт (status: locked) — у его узлов не бывает уроков`);

        const lessonBa = new Set();
        walk(lesson, "", (o) => typeof o.ba === "string" && lessonBa.add(o.ba));
        for (const w of lesson.new_words ?? []) {
          if (!lessonBa.has(w))
            errors.push(`${lr}: new_words «${w}» — не точная копия ни одной строки ba этого урока`);
        }
        for (const [ei, ex] of (lesson.exercises ?? []).entries()) {
          stats.exercises++;
          const at = `${lr}: /exercises/${ei}`;
          if (exerciseIds.has(ex.id)) errors.push(`${at} id «${ex.id}» повторяется в курсе`);
          exerciseIds.add(ex.id);
          if (
            ex.type === "choice_ba_ru" &&
            Array.isArray(ex.options_ru) &&
            ex.correct >= ex.options_ru.length
          ) {
            errors.push(`${at} correct ${ex.correct} вне options_ru (${ex.options_ru.length})`);
          }
          if (ex.type === "tiles_ru_ba" && ex.answer?.ba) {
            // Плитки — те же слова, что сравнивает сервер (answerTokens из @teletau/bashkir-text).
            const tiles = answerTokens(ex.answer.ba);
            const answerTiles = new Set(tiles);
            if (tiles.length < 2)
              errors.push(
                `${at} в ответе одна плитка — для одного слова есть choice_ba_ru и free_ru_ba`,
              );
            const seen = new Set();
            for (const d of ex.distractors ?? []) {
              if (!d?.ba) continue;
              const dt = answerTokens(d.ba);
              if (dt.length !== 1)
                errors.push(`${at} лишняя плитка «${d.ba}» — должно быть одно слово`);
              const c = dt.join(" ");
              if (answerTiles.has(c))
                errors.push(`${at} лишняя плитка «${d.ba}» совпадает с плиткой ответа`);
              if (seen.has(c)) errors.push(`${at} лишняя плитка «${d.ba}» повторяется`);
              seen.add(c);
            }
          }
          if (ex.type === "free_ru_ba") {
            const seen = new Set();
            for (const a of ex.answers ?? []) {
              if (!a?.ba) continue;
              const c = answerTokens(a.ba).join(" ");
              if (seen.has(c)) errors.push(`${at} принятый ответ «${a.ba}» повторяется`);
              seen.add(c);
            }
          }
          if (ex.type === "match_pairs") {
            // Пары однозначны: ни башкирская строка, ни перевод не повторяются (иначе верных ответов несколько).
            const seenBa = new Set();
            const seenRu = new Set();
            for (const pair of ex.pairs ?? []) {
              if (!pair?.ba) continue;
              const c = answerTokens(pair.ba).join(" ");
              if (seenBa.has(c)) errors.push(`${at} пара «${pair.ba}» повторяется`);
              seenBa.add(c);
              const ru =
                typeof pair.ru === "string"
                  ? pair.ru
                      .toLocaleLowerCase("ru")
                      .replace(/[\p{P}\s]+/gu, " ")
                      .trim()
                  : "";
              if (ru && seenRu.has(ru))
                errors.push(`${at} перевод «${pair.ru}» повторяется в парах`);
              seenRu.add(ru);
            }
          }
          if (ex.type === "duel" && ex.duel !== undefined && !pool?.has(ex.duel)) {
            errors.push(
              `${at} дуэль «${ex.duel}» не найдена в content/corpus/duels/${unitId}.yaml`,
            );
          }
        }
      }
    }
  }
  for (const lf of lessonFiles)
    if (!lessonsSeen.has(lf)) errors.push(`${rel(root, lf)}: урок вне юнита из course.units`);

  // --- очередь проверки носителем: одна строка на файл с башкирским текстом
  const queueFile = join(root, "docs/native-review-queue.md");
  const queue = existsSync(queueFile) ? readFileSync(queueFile, "utf8") : "";
  const queueRows = queue.split("\n").filter((l) => l.startsWith("|"));
  for (const r of filesWithBa) {
    if (!queueRows.some((l) => l.includes(`\`${r}\``)))
      errors.push(
        `${r}: нет строки в docs/native-review-queue.md (путь файла в обратных кавычках)`,
      );
  }

  for (const a of audioFiles)
    if (!usedAudio.has(a)) errors.push(`${a}: запись не привязана ни к одной строке (поле audio)`);
  stats.audio = usedAudio.size;

  // --- синтез озвучки строк без записи (content/audio/tts; scripts/tts/README.md)
  if (ttsFiles.size) usedSources.add("silero-tts-v5-cis");
  for (const r of ttsFiles) {
    const slug = basename(r).replace(/\.ogg$/i, "");
    if (!/^[а-яёәөүғҡңҙҫһ0-9-]+$/.test(slug))
      errors.push(`${r}: имя — слаг строки (ttsSlug): строчные башкирские буквы, цифры и «-»`);
    else if (courseSlugs.native.has(slug))
      errors.push(`${r}: у строки «${slug}» есть запись носителя — синтез не подменяет запись`);
    else if (!courseSlugs.want.has(slug))
      errors.push(`${r}: слаг «${slug}» не соответствует строке курса без записи`);
  }
  for (const slug of courseSlugs.want)
    if (!ttsFiles.has(`content/audio/tts/${slug}.ogg`))
      warnings.push(`content/audio/tts/${slug}.ogg: строки «${slug}» нет синтеза — в уроке не будет «Послушать»`);
  stats.tts = ttsFiles.size;

  for (const id of sourceIds)
    if (!usedSources.has(id))
      warnings.push(`content/sources.yaml: источник «${id}» нигде не используется`);
  return { errors, warnings, stats };
}

if (isInvokedDirectly(import.meta.url)) {
  try {
    const { errors, warnings, stats } = await checkContent();
    for (const w of warnings) console.warn(`предупреждение: ${w}`);
    if (errors.length) {
      console.error(`Контент не прошёл проверку (${errors.length}):\n  ${errors.join("\n  ")}`);
      process.exit(1);
    }
    console.log(
      `Контент в порядке: файлов ${stats.files}, уроков ${stats.lessons}, упражнений ${stats.exercises}, дуэлей ${stats.duels}, ` +
        `башкирских строк ${stats.baStrings}, записей произношения ${stats.audio}, источников ${stats.sources}.`,
    );
  } catch (e) {
    console.error(`check-content: ${e.message}`);
    process.exit(1);
  }
}
