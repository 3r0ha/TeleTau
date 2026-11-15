// Мир ученика для моков API (mock-api.ts) — по контракту (Schema<"…"> из @teletau/contracts): тропа, урок, итог,
// лига, улей, вклад; повторение слов с «Парами», «Мой словарь», цель дня; карточки «Новое слово» и подсказки
// к условию (word_intro, hints).
//
// Башкирские строки — только строки утверждённого прототипа v2 (prototypes/trail-expedition), уже стоящие в очереди
// проверки носителем (docs/native-review-queue.md, №11–15: места, «плитки», «выбор», «ввод», дуэль). Новых башкирских
// слов здесь нет; демо-контент из открытых источников — content/**, его импортирует API.
import type { Schema } from "@teletau/contracts";

type Course = Schema<"Course">;
type TrailNode = Schema<"TrailNode">;
type RunExercise = Schema<"RunExercise">;
type AttemptResult = Schema<"AttemptResult">;
type AttemptAnswer = Schema<"AttemptAnswer">;

/** Ключ ответа — только на «сервере» мока (клиент получает упражнения без ключей). */
export type AnswerKey =
  | { kind: "tiles"; tileIds: string[]; answer: string; meaningRu: string }
  | { kind: "choice"; optionId: string }
  | { kind: "text"; answer: string; meaningRu: string }
  | { kind: "pairs"; pairs: Record<string, string> }
  | { kind: "duel" };

export interface MockLesson {
  run: Omit<Schema<"LessonRun">, "runId" | "startedAt" | "status">;
  keys: Record<string, AnswerKey>;
}

export interface LearnWorld {
  course: Course;
  progress: Schema<"MyProgress">;
  /** Упражнения урока по lessonId с ключами; урок, которого нет, — первый из списка. */
  lessons: Record<string, MockLesson>;
  summary: Schema<"LessonRunSummary">;
  /** Итог забега повторения (POST /reviews/runs → complete). */
  reviewSummary: Schema<"LessonRunSummary">;
  /** «Мой словарь» (GET /me/words). */
  words: Schema<"MyWords">;
  /** Награды (GET /me/achievements); новые после урока — summary.newAchievements. */
  achievements: Schema<"MyAchievements">;
  league: Schema<"LeagueStanding">;
  hive: Schema<"ClassHive">;
  cells: Schema<"MyCellsPage">;
  /** Журнал: начатые забеги (accepts — что клиент попросил сверх базовых упражнений), ответы, итоги, отметки итога лиги. */
  runs: { lessonId: string; runId: string; accepts?: Schema<"RunFeature">[]; kind?: Schema<"RunKind"> }[];
  attempts: { runId: string; body: Schema<"AttemptRequest">; result: AttemptResult }[];
  completes: string[];
  resultSeen: string[];
}

export const LESSON_ID = "u01-moya-shkola";
/** Текущий узел тропы («Урок «…» — начать»): с него начинается следующий урок. */
export const CURRENT_NODE = / — начать$/;

const REVIEW = "needs_native_review" as const;
const ba = (text: string): Schema<"BaString"> => ({ text, review: REVIEW });
const LETTERS = ["ә", "ө", "ү", "ғ", "ҡ", "ң", "ҙ", "ҫ", "һ"];

const node = (id: string, kind: TrailNode["kind"], state: TrailNode["state"], titleRu: string, icon?: TrailNode["icon"]): TrailNode => ({
  id,
  kind,
  state,
  titleRu,
  ...(icon ? { icon } : {}),
});

/** Тропа демо-ученика «Смелая пчела»: пройдены 3 узла юнита 1. */
export function demoCourse(): Course {
  return {
    id: "ba-ru",
    contentVersion: 2,
    units: [
      {
        id: "01-ufa",
        order: 1,
        state: "open",
        place: { slug: "ufa", titleRu: "Уфа", titleBa: ba("Өфө") },
        topicRu: "Знакомство",
        nodes: [
          node("u01-privet", "lesson", "done", "Привет!", "star"),
          node("u01-kak-tebya-zovut", "lesson", "done", "Как вас зовут?", "chat-circle-text"),
          node("u01-help-1", "help_language", "done", "Помоги языку"),
          node(LESSON_ID, "lesson", "current", "Моя школа", "book-open"),
          node("u01-vezhlivye-slova", "lesson", "locked", "Вежливые слова", "star"),
          node("u01-help-2", "help_language", "locked", "Помоги языку"),
          node("u01-ispytanie", "place_test", "locked", "Испытание места"),
        ],
      },
      {
        id: "02-shulgantash",
        order: 2,
        state: "locked",
        place: { slug: "shulgantash", titleRu: "Шульган-Таш", titleBa: ba("Шүлгәнташ") },
        topicRu: "Семья",
        nodes: [
          node("u02-1", "lesson", "locked", "Мама и папа", "star"),
          node("u02-2", "lesson", "locked", "Братья и сёстры", "chat-circle-text"),
          node("u02-3", "help_language", "locked", "Помоги языку"),
          node("u02-4", "lesson", "locked", "Мой дом", "book-open"),
          node("u02-5", "lesson", "locked", "Повторение", "barbell"),
          node("u02-6", "help_language", "locked", "Помоги языку"),
          node("u02-7", "lesson", "locked", "Бабушка и дедушка", "star"),
          node("u02-8", "place_test", "locked", "Испытание места"),
        ],
      },
      {
        id: "03-agidel",
        order: 3,
        state: "locked",
        place: { slug: "agidel", titleRu: "Агидель", titleBa: ba("Ағиҙел") },
        topicRu: "Природа",
        nodes: [
          node("u03-1", "lesson", "locked", "Река", "star"),
          node("u03-2", "lesson", "locked", "Лес и горы", "chat-circle-text"),
          node("u03-3", "help_language", "locked", "Помоги языку"),
          node("u03-4", "lesson", "locked", "Погода", "book-open"),
          node("u03-5", "lesson", "locked", "Повторение", "barbell"),
          node("u03-6", "help_language", "locked", "Помоги языку"),
          node("u03-7", "lesson", "locked", "Звери и птицы", "star"),
          node("u03-8", "place_test", "locked", "Испытание места"),
        ],
      },
      {
        // Как курс версии 2 (content/course/ba-ru/units/04-yamantau): закрытый юнит — только подписи узлов. Башкирского названия
        // в моке нет — показывается русское.
        id: "04-yamantau",
        order: 4,
        state: "locked",
        place: { slug: "yamantau", titleRu: "Гора Ямантау" },
        topicRu: "Числа и время",
        nodes: [
          node("u04-l1", "lesson", "locked", "Считаем до десяти", "star"),
          node("u04-l2", "lesson", "locked", "Который час?", "chat-circle-text"),
          node("u04-help-1", "help_language", "locked", "Помоги языку"),
          node("u04-l3", "lesson", "locked", "Дни недели", "book-open"),
          node("u04-l4", "lesson", "locked", "Повторение", "barbell"),
          node("u04-help-2", "help_language", "locked", "Помоги языку"),
          node("u04-l5", "lesson", "locked", "Месяцы", "star"),
          node("u04-test", "place_test", "locked", "Испытание места"),
        ],
      },
      {
        // Как курс версии 2 (content/course/ba-ru/units/05-village): закрытый юнит — только подписи узлов. Башкирского названия
        // в моке нет — показывается русское.
        id: "05-village",
        order: 5,
        state: "locked",
        place: { slug: "village", titleRu: "Башкирская деревня" },
        topicRu: "Еда",
        nodes: [
          node("u05-l1", "lesson", "locked", "Завтрак", "star"),
          node("u05-l2", "lesson", "locked", "Мёд и чай", "chat-circle-text"),
          node("u05-help-1", "help_language", "locked", "Помоги языку"),
          node("u05-l3", "lesson", "locked", "На кухне", "book-open"),
          node("u05-l4", "lesson", "locked", "Повторение", "barbell"),
          node("u05-help-2", "help_language", "locked", "Помоги языку"),
          node("u05-l5", "lesson", "locked", "Праздничный стол", "star"),
          node("u05-test", "place_test", "locked", "Испытание места"),
        ],
      },
      {
        // Как курс версии 2 (content/course/ba-ru/units/06-sabantuy): закрытый юнит — только подписи узлов. Башкирского названия
        // в моке нет — показывается русское.
        id: "06-sabantuy",
        order: 6,
        state: "locked",
        place: { slug: "sabantuy", titleRu: "Сабантуй" },
        topicRu: "Праздники и игры",
        nodes: [
          node("u06-l1", "lesson", "locked", "Праздники", "star"),
          node("u06-l2", "lesson", "locked", "Игры", "chat-circle-text"),
          node("u06-help-1", "help_language", "locked", "Помоги языку"),
          node("u06-l3", "lesson", "locked", "Курэш и скачки", "book-open"),
          node("u06-l4", "lesson", "locked", "Повторение", "barbell"),
          node("u06-help-2", "help_language", "locked", "Помоги языку"),
          node("u06-l5", "lesson", "locked", "Поздравления", "star"),
          node("u06-test", "place_test", "locked", "Испытание места"),
        ],
      },
    ],
  };
}

/**
 * Урок «Моя школа» — упражнения прототипа (05–11): плитки, выбор, ввод с панелью букв, дуэль. Перед упражнениями с
 * новыми словами — карточки «Новое слово» (их получает клиент, который попросил accepts: [word_intro], — как у API);
 * у плиток — подсказки к отдельным словам условия из словаря. У ввода «Спасибо!» подсказки нет: она покрыла бы всё
 * условие и выдала бы ответ (как у API).
 */
export function demoLesson(): MockLesson {
  const tile = (id: string, text: string) => ({ id, text });
  const intro = (id: string, word: Schema<"BaString">, translationRu: string): RunExercise => ({ id, type: "word_intro", review: REVIEW, word, translationRu });
  const exercises: RunExercise[] = [
    intro("e-new-mektep", { ...ba("мәктәп"), audio: MOCK_AUDIO }, "школа"),
    intro("e-new-baram", ba("барам"), "иду"),
    {
      id: "e-tiles",
      type: "tiles_ru_ba",
      review: REVIEW,
      promptRu: "Я иду в школу.",
      hints: [
        { text: "Я", translation: ba("Мин") },
        { text: "иду", translation: ba("барам") },
      ],
      tiles: [tile("t1", "барам"), tile("t2", "Һин"), tile("t3", "мәктәпкә"), tile("t4", "өйгә"), tile("t5", "Мин"), tile("t6", "бара")],
    },
    {
      id: "e-choice",
      type: "choice_ba_ru",
      review: REVIEW,
      prompt: "Сәләм!",
      options: [
        { id: "o1", textRu: "Привет!" },
        { id: "o2", textRu: "Спасибо" },
        { id: "o3", textRu: "Спокойной ночи" },
        { id: "o4", textRu: "Да" },
      ],
    },
    intro("e-new-rakhmat", ba("Рәхмәт!"), "Спасибо!"),
    { id: "e-free", type: "free_ru_ba", review: REVIEW, promptRu: "Спасибо!", letters: LETTERS },
    { id: "e-duel", type: "duel", review: REVIEW, itemId: "0193f7a4-0000-7000-8000-0000000d0001", sourceRu: "Добрый день", a: "Хәйерле көн", b: "Яҡшы көн" },
  ];
  return {
    run: { lessonId: LESSON_ID, kind: "lesson", titleRu: "Моя школа", exercises },
    keys: {
      "e-tiles": { kind: "tiles", tileIds: ["t5", "t3", "t1"], answer: "Мин мәктәпкә барам.", meaningRu: "Я иду в школу." },
      "e-choice": { kind: "choice", optionId: "o1" },
      "e-free": { kind: "text", answer: "Рәхмәт!", meaningRu: "Спасибо!" },
      "e-duel": { kind: "duel" },
    },
  };
}

/**
 * Запись, как её отдаёт API: копия на нашем сайте (public/audio, scripts/prepare-audio.mjs) — AAC и оригинал Ogg.
 * Это настоящая копия записи «көн»; в моке она висит на другом слове — важна только кнопка и откуда грузится файл.
 */
export const MOCK_AUDIO: Schema<"AudioClip"> = {
  origin: "native",
  url: "/audio/288218d294ae3224.m4a",
  files: [
    { url: "/audio/288218d294ae3224.m4a", type: 'audio/mp4; codecs="mp4a.40.2"' },
    { url: "/audio/288218d294ae3224.ogg", type: 'audio/ogg; codecs="vorbis"' },
  ],
};

/**
 * Повторение слов: выбор с записью, ввод и «Пары» — на строках прототипа из очереди проверки (№12–14):
 * Сәләм! — «Привет!», Рәхмәт! — «Спасибо!», Хәйерле көн — «Добрый день», мәктәп — «школа».
 */
export function demoReview(): MockLesson {
  const exercises: RunExercise[] = [
    {
      id: "r-choice",
      type: "choice_ba_ru",
      review: REVIEW,
      prompt: "Сәләм!",
      promptAudio: MOCK_AUDIO,
      options: [
        { id: "ro1", textRu: "Спасибо" },
        { id: "ro2", textRu: "Привет!" },
        { id: "ro3", textRu: "Да" },
      ],
    },
    { id: "r-free", type: "free_ru_ba", review: REVIEW, promptRu: "Спасибо!", letters: LETTERS },
    {
      id: "r-pairs",
      type: "match_pairs",
      review: REVIEW,
      left: [
        { id: "pl1", text: "Хәйерле көн" },
        { id: "pl2", text: "Сәләм!" },
        { id: "pl3", text: "мәктәп" },
        { id: "pl4", text: "Рәхмәт!" },
      ],
      right: [
        { id: "pr1", textRu: "Спасибо!" },
        { id: "pr2", textRu: "Добрый день" },
        { id: "pr3", textRu: "Привет!" },
        { id: "pr4", textRu: "школа" },
      ],
    },
  ];
  return {
    run: { lessonId: "review", kind: "review", titleRu: "Повторение", exercises },
    keys: {
      "r-choice": { kind: "choice", optionId: "ro2" },
      "r-free": { kind: "text", answer: "Рәхмәт!", meaningRu: "Спасибо!" },
      "r-pairs": { kind: "pairs", pairs: { pl1: "pr2", pl2: "pr3", pl3: "pr4", pl4: "pr1" } },
    },
  };
}

/** «Мой словарь» демо-ученика: строки прототипа из очереди проверки (№12–14). */
function demoWords(): Schema<"MyWords"> {
  const w = (text: string, translationRu: string, status: Schema<"WordStatus">, audio = false): Schema<"MyWord"> => ({
    id: text.toLocaleLowerCase("ru").replace(/[!?.]/g, ""),
    word: { ...ba(text), ...(audio ? { audio: MOCK_AUDIO } : {}) },
    translationRu,
    status,
  });
  const words = [
    w("Сәләм!", "Привет!", "review", true),
    w("Рәхмәт!", "Спасибо!", "review"),
    w("Хәйерле көн", "Добрый день", "review"),
    w("мәктәп", "школа", "learned", true),
    w("барам", "иду", "learned"),
    w("Мин", "я", "learned"),
    w("Һин", "ты", "learned"),
  ];
  return { summary: { total: words.length, learned: 4, review: 3 }, words };
}

/** Награды набора — тексты как у сервера (apps/api/src/modules/learning/achievements.ts). */
const AWARDS: [Schema<"AchievementId">, string, string, Schema<"AchievementIcon">, number][] = [
  ["first-lesson", "Первый урок", "Пройди первый урок", "footprints", 1],
  ["perfect-lesson", "Без ошибок", "Пройди урок без ошибок", "seal-check", 1],
  ["streak-3", "3 дня подряд", "Занимайся 3 дня подряд", "fire", 3],
  ["streak-7", "7 дней подряд", "Занимайся 7 дней подряд", "fire", 7],
  ["streak-30", "30 дней подряд", "Занимайся 30 дней подряд", "fire", 30],
  ["goal-7", "7 целей дня", "Выполни цель дня 7 раз", "target", 7],
  ["words-10", "10 слов", "Выучи 10 слов", "book-open", 10],
  ["words-50", "50 слов", "Выучи 50 слов", "books", 50],
  ["first-vote", "Первый голос", "Проголосуй в «Помоги языку»", "scales", 1],
  ["votes-10", "10 голосов", "Отдай 10 голосов в «Помоги языку»", "scales", 10],
  ["first-place", "Место пройдено", "Пройди все уроки одного места", "map-pin", 1],
  ["all-places", "Вся тропа", "Пройди все места", "flag-banner", 6],
];

/** Награда набора: earnedOn — получена, иначе progress из target. */
export function award(id: Schema<"AchievementId">, state: { earnedOn?: string; progress?: number } = {}): Schema<"Achievement"> {
  const [, titleRu, descriptionRu, icon, target] = AWARDS.find((a) => a[0] === id)!;
  return { id, titleRu, descriptionRu, icon, ...(state.earnedOn ? { earnedOn: state.earnedOn } : {}), progress: state.earnedOn ? target : (state.progress ?? 0), target };
}

/** Награды демо-ученика: серия 5 дней, 7 слов в словаре, 41 голос, первое место ещё не пройдено. */
export function demoAchievements(): Schema<"MyAchievements"> {
  const earned: Partial<Record<Schema<"AchievementId">, string>> = {
    "first-lesson": "2026-11-03",
    "perfect-lesson": "2026-11-04",
    "streak-3": "2026-11-05",
    "first-vote": "2026-11-05",
    "votes-10": "2026-11-07",
  };
  const progress: Partial<Record<Schema<"AchievementId">, number>> = { "streak-7": 5, "streak-30": 5, "goal-7": 4, "words-10": 7, "words-50": 7 };
  const achievements = AWARDS.map(([id]) => award(id, { ...(earned[id] ? { earnedOn: earned[id] } : {}), progress: progress[id] ?? 0 }));
  return { earned: achievements.filter((a) => a.earnedOn).length, total: achievements.length, achievements };
}

const DAY = 86_400_000;
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

function streak(current: number, doneToday: boolean): Schema<"StreakState"> {
  return {
    current,
    longest: Math.max(current, 9),
    freezes: 2,
    extendedToday: doneToday,
    today: WEEK[5]!,
    week: WEEK.map((date, i) => ({ date, status: i < 5 ? "done" : i === 5 ? (doneToday ? "done" : "today") : "future" })),
  };
}

// Ники — из словаря (аватар по существительному), кроме «Сонный ёжик»: слова нет в словаре — остаётся цветная ячейка.
const NICKS: [string, number, boolean?][] = [
  ["Ловкий шмель", 412],
  ["Ясная ромашка", 388],
  ["Быстрая ласточка", 351],
  ["Лесная белка", 330],
  ["Смелая пчела", 318, true],
  ["Звонкий журавль", 244],
  ["Добрый барсук", 201],
  ["Мудрая сова", 120],
  ["Сонный ёжик", 64],
  ["Весёлый заяц", 31],
];

export function learnWorld(): LearnWorld {
  const members: Schema<"LeagueMember">[] = NICKS.map(([nickname, points, me], i) => ({
    rank: i + 1,
    nickname,
    points,
    me: Boolean(me),
    zone: i < 5 ? "promote" : i >= NICKS.length - 3 ? "demote" : "stay",
  }));
  return {
    course: demoCourse(),
    progress: {
      honey: { total: 245, pending: 15 },
      streak: streak(5, false),
      league: { tier: "sweetclover", points: 318, rank: 5 },
      lessonsCompleted: 2,
      wordsLearned: 86,
      votes: { total: 41, matured: 7, pending: 5 },
      dailyGoal: { target: 2, done: 0, met: false },
    },
    lessons: {
      [LESSON_ID]: demoLesson(),
      // «Помоги языку» пройден: дуэлей, за которые ученик ещё не голосовал, не осталось — забег без упражнений.
      "u01-help-1": { run: { lessonId: "u01-help-1", kind: "help_language", titleRu: "Помоги языку", exercises: [] }, keys: {} },
      review: demoReview(),
    },
    summary: {
      runId: "",
      lessonId: LESSON_ID,
      honey: { total: 12, base: 10, firstTry: 2, multiplier: 1, pendingFromVotes: 3 },
      accuracy: 2 / 3,
      durationSeconds: 161,
      newWords: [ba("мәктәп"), ba("барам"), ba("рәхмәт")],
      votes: 1,
      streak: streak(6, true),
      leagueResult: { weekStart: "2026-11-02", tierBefore: "sweetclover", tierAfter: "fireweed", outcome: "promoted", rank: 5, points: 318 },
      dailyGoal: { target: 2, done: 1, met: false },
      dailyGoalReached: false,
    },
    reviewSummary: {
      runId: "",
      lessonId: "review",
      honey: { total: 12, base: 10, firstTry: 2, multiplier: 1, pendingFromVotes: 0 },
      accuracy: 2 / 3,
      durationSeconds: 74,
      newWords: [],
      votes: 0,
      streak: streak(6, true),
      dailyGoal: { target: 2, done: 2, met: true },
      dailyGoalReached: true,
    },
    words: demoWords(),
    achievements: demoAchievements(),
    league: {
      week: { start: WEEK[0]!, end: WEEK[6]! },
      endsAt: new Date(Date.now() + 2.5 * DAY).toISOString(),
      tier: "sweetclover",
      zones: { promote: 5, demote: 3 },
      members,
      me: members[4]!,
    },
    hive: {
      classId: "0193f7a4-0000-7000-8000-00000000c005",
      week: { start: WEEK[0]!, end: WEEK[6]! },
      quest: { titleRu: "Пройдите всем классом 300 уроков", goal: 300, progress: 214, completed: false },
      participation: { active: 18, total: 24 },
      days: WEEK.map((date, i) => ({ date, active: [12, 15, 9, 14, 11, 6, 0][i]! })),
    },
    cells: { summary: { matured: 7, pending: 5, honeyFinal: 19, honeyPending: 15 }, items: [] },
    runs: [],
    attempts: [],
    completes: [],
    resultSeen: [],
  };
}

const strip = (s: string) => s.normalize("NFC").toLocaleLowerCase("ru").replace(/[!?.,«»"]/g, "").replace(/\s+/g, " ").trim();
const FOLD: Record<string, string> = { "ә": "а", "ө": "о", "ү": "у", "ғ": "г", "ҡ": "к", "ң": "н", "ҙ": "з", "ҫ": "с", "һ": "х" };
const fold = (s: string) => strip(s).replace(/[әөүғҡңҙҫһ]/g, (c) => FOLD[c] ?? c);

/**
 * Проверка ответа «сервером» мока — упрощённо, как matchAnswer (векторы answer-check): верно / почти (буква) / неверно.
 * Настоящая проверка — пакет bashkir-text на сервере. `first` — первая ли это попытка по упражнению: как у API
 * (shouldRetry), неверный ответ возвращается в конец урока только после первой попытки, второй — уже нет.
 */
export function judge(key: AnswerKey, answer: AttemptAnswer, ids: { attemptId: string; exerciseId: string }, first: boolean): AttemptResult {
  const base = { ...ids, firstAttempt: first };
  const retry = (ok: boolean) => !ok && first;
  if (key.kind === "duel") return { ...base, verdict: "recorded", retry: false };
  if (key.kind === "choice") {
    const ok = answer.type === "choice" && answer.optionId === key.optionId;
    return { ...base, verdict: ok ? "correct" : "wrong", retry: retry(ok), correctOptionId: key.optionId };
  }
  if (key.kind === "pairs") {
    const links = answer.type === "pairs" ? answer.pairs : [];
    const ok = links.length === Object.keys(key.pairs).length && links.every((l) => key.pairs[l.left] === l.right);
    return { ...base, verdict: ok ? "correct" : "wrong", retry: retry(ok), correctPairs: Object.entries(key.pairs).map(([left, right]) => ({ left, right })) };
  }
  if (key.kind === "tiles") {
    const ok = answer.type === "tiles" && answer.tileIds.join() === key.tileIds.join();
    return { ...base, verdict: ok ? "correct" : "wrong", retry: retry(ok), correctAnswer: ba(key.answer), meaningRu: key.meaningRu };
  }
  const text = answer.type === "text" ? answer.text : "";
  const rest = { correctAnswer: ba(key.answer), meaningRu: key.meaningRu };
  if (strip(text) === strip(key.answer)) return { ...base, ...rest, verdict: "correct", retry: false };
  if (fold(text) === fold(key.answer)) {
    const want = [...strip(key.answer)];
    const got = [...strip(text)];
    const index = want.findIndex((c, i) => FOLD[c] && got[i] !== c);
    const hint = index >= 0 ? { expected: want[index]!, got: got[index] ?? "", token: 0, index } : undefined;
    return { ...base, ...rest, verdict: "almost", retry: false, ...(hint ? { hint } : {}) };
  }
  return { ...base, ...rest, verdict: "wrong", retry: first };
}

/** Итог урока на «сервере» мока: узел запечатан, следующий открыт, мёд и серия обновлены. */
export function applyCompletion(w: LearnWorld, lessonId: string): void {
  // Задание учителя засчитывается прохождением заданного урока или повторения (ADR 0021).
  if (w.course.assignments) {
    w.course = { ...w.course, assignments: w.course.assignments.map((a) => (a.kind === "review" ? lessonId === "review" : a.lessonId === lessonId) ? { ...a, done: true } : a) };
  }
  if (lessonId === "review") {
    // Повторение: слов к сроку больше нет, в словаре — «выучено», сота цели дня.
    w.course = { ...w.course, review: { due: 0 } };
    w.words = { summary: { ...w.words.summary, learned: w.words.summary.total, review: 0 }, words: w.words.words.map((x) => ({ ...x, status: "learned" })) };
    w.progress = { ...w.progress, dailyGoal: w.reviewSummary.dailyGoal, streak: w.reviewSummary.streak };
    return;
  }
  // Новые награды итога — теперь получены и в профиле.
  const fresh = new Map((w.summary.newAchievements ?? []).map((a) => [a.id, a]));
  if (fresh.size) {
    const achievements = w.achievements.achievements.map((a) => fresh.get(a.id) ?? a);
    w.achievements = { ...w.achievements, achievements, earned: achievements.filter((a) => a.earnedOn).length };
  }
  const nodes = w.course.units.flatMap((u) => u.nodes);
  const i = nodes.findIndex((n) => n.id === lessonId);
  if (i >= 0) {
    nodes[i]!.state = "done";
    const next = nodes.slice(i + 1).find((n) => n.state === "locked");
    if (next) next.state = "current";
  }
  w.progress = {
    ...w.progress,
    streak: w.summary.streak,
    ...(w.summary.dailyGoal ? { dailyGoal: w.summary.dailyGoal } : {}),
    honey: { total: w.progress.honey.total + w.summary.honey.total, pending: w.progress.honey.pending + w.summary.honey.pendingFromVotes },
    lessonsCompleted: w.progress.lessonsCompleted + 1,
  };
}
