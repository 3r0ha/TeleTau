// Мир учителя для моков API (mock-api.ts) — по контракту (Schema<"…"> из @teletau/contracts): «Прогресс» класса
// (getClassProgress), «Помогите языку» (listCorpusDuels, submitCorpusJudgment, getCorpusItemVotes) и «Что в уроке»
// (getLessonPreview).
//
// Башкирские строки — только из content/corpus/duels/01-ufa.yaml и уроков content/course (источники — content/sources.yaml),
// они уже в очереди проверки носителем (docs/native-review-queue.md). Новых башкирских слов здесь нет. Ники — русские,
// из словаря ников.
import type { Schema } from "@teletau/contracts";
import { demoCourse } from "./mock-learn";

type Seat = Schema<"Seat">;
type SeatProgress = Schema<"SeatProgress">;
type CorpusDuel = Schema<"CorpusDuel">;
type GroupTally = Schema<"GroupTally">;
type CorpusItemVotes = Schema<"CorpusItemVotes">;
type JudgmentRequest = Schema<"JudgmentRequest">;
type Group = keyof Schema<"GroupTallies">;

export const TEACHER_CLASS_NICKS = [
  "Ловкий шмель",
  "Тихая липа",
  "Быстрый курай",
  "Ясный ручей",
  "Звонкий жаворонок",
  "Добрый барсук",
  "Смелая пчела",
  "Мудрая сова",
  "Весёлый хомяк",
  "Сонный ёжик",
  "Тёплый ветер",
  "Зоркий сокол",
  "Шустрая белка",
  "Рыжий лис",
  "Верный конь",
  "Пёстрый дятел",
  "Серебряный карась",
  "Лесная земляника",
  "Горный орёл",
  "Тихий пруд",
  "Медовый цветок",
  "Северный олень",
];

const iso = (offsetMs = 0) => new Date(Date.parse("2026-11-03T09:12:00Z") + offsetMs).toISOString();

/** Места 5 «Б» демо-мира: 24 места, 22 ученика, на №07 — «Смелая пчела». */
export function demoSeats(total = 24): Seat[] {
  return Array.from({ length: total }, (_, i) => {
    const number = i + 1;
    const nick = TEACHER_CLASS_NICKS[i];
    const seat: Seat = { number, cardStatus: "active", cardVersion: 1, cardIssuedAt: iso(-86_400_000) };
    if (nick) seat.student = { accountId: `0193f7a4-0000-7000-8000-0000000s00${String(number).padStart(2, "0")}`, nickname: nick, joinedAt: iso(-3_600_000) };
    return seat;
  });
}

const ufaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY = 86_400_000;
/** Сутки по Уфе со сдвигом в днях от сегодня (часы теста). */
const ufaDay = (shiftDays = 0) => ufaDate.format(new Date(Date.now() + shiftDays * DAY));

/** Текущая неделя пн–вс по Уфе. */
function currentWeek(): Schema<"Week"> {
  const today = Date.parse(`${ufaDay()}T12:00:00Z`);
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const start = new Date(today - weekday * DAY).toISOString().slice(0, 10);
  const end = new Date(today + (6 - weekday) * DAY).toISOString().slice(0, 10);
  return { start, end };
}

/** Номера мест с учеником (аккаунтом) — один источник знаменателя для прогресса, заданий и страницы класса, как у API. */
export const studentNumbers = (seats: readonly Seat[]) => seats.filter((s) => s.student).map((s) => s.number);

/** Последнее место, на котором ученик уже занимался; дальше (№22 демо-класса и новенькие) — «пока без уроков». */
const LAST_WITH_PROGRESS = 21;

/**
 * Прогресс по номерам мест — без ников (ники — только в GET /classes/{id}): только места с учениками. №22 и пришедшие
 * позже ещё не занимались, №07 — герой показа.
 */
function demoSeatProgress(students: readonly number[] = studentNumbers(demoSeats())): SeatProgress[] {
  const out: SeatProgress[] = [];
  for (const n of students) {
    if (n > LAST_WITH_PROGRESS) continue;
    // 18 из 24 занимались на этой неделе: 21 место с прогрессом минус 3 без занятий (№04, №11, №16).
    const idle = [4, 11, 16].includes(n);
    const lessonsCompleted = n === 7 ? 3 : 1 + ((n * 7) % 4);
    const thisWeek = idle ? 0 : Math.min(lessonsCompleted, 1 + (n % 3));
    out.push({
      seatNumber: n,
      lessonsCompleted,
      wordsLearned: lessonsCompleted * 6 + (n % 4),
      lessonsThisWeek: n === 7 ? 3 : thisWeek,
      honeyThisWeek: n === 7 ? 36 : thisWeek * 12 + ((n * 5) % 7),
      // Серия идёт, только если занимался сегодня или вчера.
      streak: n === 7 ? 6 : idle ? 0 : 1 + ((n * 3) % 7),
      lastActiveOn: n === 7 ? ufaDay() : ufaDay(idle ? -(8 + n) : -(n % 2)),
      accuracy: n === 7 ? 0.86 : 0.6 + ((n * 13) % 35) / 100,
    });
  }
  return out;
}

/** Сделали задание «Моя школа» (у героя показа №07 — ещё нет); они же прошли урок «Моя школа» в «Прогрессе». */
const MY_SCHOOL_DONE = new Set([1, 2, 3, 5, 6, 9, 12, 14, 19]);

/**
 * Кто прошёл урок тропы — по номеру места; в демо-классе из 22 учеников в Уфе: 19, 15, 9, 3 и 0. Дальше по тропе забежали
 * трое (№01, №05, №09): у Шульган-Таша — 3, 2, 1, остальные места — пока без прохождений.
 */
const LESSON_DONE: Record<string, (n: number) => boolean> = {
  "u01-privet": (n) => ![4, 16].includes(n),
  "u01-kak-tebya-zovut": (n) => ![4, 8, 11, 12, 16, 20].includes(n),
  "u01-moya-shkola": (n) => MY_SCHOOL_DONE.has(n),
  "u01-vezhlivye-slova": (n) => [1, 5, 9].includes(n),
  "u01-ispytanie": () => false,
  "u02-1": (n) => [1, 5, 9].includes(n),
  "u02-2": (n) => [1, 5].includes(n),
  "u02-4": (n) => n === 1,
};

/** Места тропы для «Прохождения уроков»: все юниты курса, уроки и «Испытания» (без «Помоги языку»), как progress.service. */
function trailUnits() {
  const units = demoCourse().units;
  return {
    units: units.map((u) => ({ id: u.id, order: u.order, place: u.place, topicRu: u.topicRu })),
    lessons: units.flatMap((u) => u.nodes.filter((n) => n.kind !== "help_language").map((n) => ({ lessonId: n.id, titleRu: n.titleRu, unitId: u.id, kind: n.kind }))),
  };
}

/** Прогресс класса — по его местам: знаменатель везде один, ученики с аккаунтом (как progress.service на API). */
export function demoClassProgress(classId: string, classSeats: readonly Seat[] = demoSeats()): Schema<"ClassProgress"> {
  const students = studentNumbers(classSeats);
  const seats = demoSeatProgress(students);
  const studied = seats.map((p) => p.seatNumber);
  const trail = trailUnits();
  return {
    classId,
    week: currentWeek(),
    summary: {
      seatsTotal: classSeats.length,
      // Знаменатель «Занимались N из M» — ученики с аккаунтом (в демо 22 из 24 мест заняты), а не все места.
      studentsTotal: students.length,
      activeSeats: seats.filter((p) => p.lessonsThisWeek > 0).length,
      lessonsCompleted: seats.reduce((s, p) => s + p.lessonsThisWeek, 0),
      honeyEarned: seats.reduce((s, p) => s + p.honeyThisWeek, 0),
      votes: 27,
    },
    seats,
    lessons: trail.lessons.map((l) => ({ ...l, completedSeats: LESSON_DONE[l.lessonId] ? studied.filter(LESSON_DONE[l.lessonId]!).length : 0 })),
    units: trail.units,
  };
}

const REVIEW = "needs_native_review" as const;
const WIKIVOYAGE = { title: "Викигид: башкирский разговорник", url: "https://ru.wikivoyage.org/wiki/Башкирский_разговорник", license: "CC BY-SA 4.0" };

interface MockItem {
  duel: CorpusDuel;
  /** Голоса до учителя: дети (из уроков) и взрослые из других демо-школ. */
  base: Record<Group, { a: number; b: number; both: number; skip: number }>;
}

const id = (n: number, v: string) => `0193f7a4-0000-7000-8000-0000000d${String(n).padStart(3, "0")}${v}`;
const zero = { a: 0, b: 0, both: 0, skip: 0 };

/** Три дуэли юнита 1 из content/corpus/duels/01-ufa.yaml. */
function demoItems(): MockItem[] {
  return [
    {
      duel: {
        itemId: id(1, "0"),
        sourceRu: "Здравствуйте!",
        variants: [
          { variantId: id(1, "a"), text: "Һаумыһығыҙ!" },
          { variantId: id(1, "b"), text: "Иҫәнмеһегеҙ!" },
        ],
        review: REVIEW,
        sources: [
          { title: "Tatoeba", url: "https://tatoeba.org/ru/sentences/show/2839364", locator: "предложение №2839364", license: "CC BY 2.0 FR" },
          { title: "Корпус AigizK", url: "https://huggingface.co/datasets/AigizK/bashkir-russian-parallel-corpora" },
        ],
      },
      base: { child: { a: 6, b: 2, both: 1, skip: 1 }, adult: { a: 2, b: 1, both: 0, skip: 0 }, teacher: zero },
    },
    {
      duel: {
        itemId: id(2, "0"),
        sourceRu: "Как Вас зовут?",
        variants: [
          { variantId: id(2, "a"), text: "Исемегеҙ кем?" },
          { variantId: id(2, "b"), text: "Исемегеҙ нисек?" },
        ],
        review: REVIEW,
        sources: [WIKIVOYAGE],
      },
      base: { child: { a: 2, b: 5, both: 0, skip: 1 }, adult: { a: 2, b: 0, both: 0, skip: 0 }, teacher: zero },
    },
    {
      duel: {
        itemId: id(3, "0"),
        sourceRu: "Хорошо, спасибо.",
        variants: [
          { variantId: id(3, "a"), text: "Рәхмәт, һәйбәт." },
          { variantId: id(3, "b"), text: "Рәхмәт, яҡшы." },
        ],
        review: REVIEW,
        sources: [WIKIVOYAGE],
      },
      base: { child: { a: 3, b: 3, both: 2, skip: 0 }, adult: zero, teacher: zero },
    },
  ];
}

// ───── Задания учителя (ADR 0021) и карточка ученика ─────

type Assignment = Schema<"ClassAssignment">;
type AssignmentSeat = Schema<"AssignmentSeat">;

/** Что можно задать: уроки и «Испытания» открытых юнитов (как options в listClassAssignments). */
export const ASSIGNMENT_OPTIONS: Schema<"AssignmentOption">[] = [
  { kind: "lesson", lessonId: "u01-privet", titleRu: "Привет!", placeRu: "Уфа", unitOrder: 1 },
  { kind: "lesson", lessonId: "u01-kak-tebya-zovut", titleRu: "Как вас зовут?", placeRu: "Уфа", unitOrder: 1 },
  { kind: "lesson", lessonId: "u01-moya-shkola", titleRu: "Моя школа", placeRu: "Уфа", unitOrder: 1 },
  { kind: "lesson", lessonId: "u01-vezhlivye-slova", titleRu: "Вежливые слова", placeRu: "Уфа", unitOrder: 1 },
  { kind: "place_test", lessonId: "u01-ispytanie", titleRu: "Испытание места", placeRu: "Уфа", unitOrder: 1 },
  { kind: "lesson", lessonId: "u02-mama-i-papa", titleRu: "Мама и папа", placeRu: "Шульган-Таш", unitOrder: 2 },
  { kind: "lesson", lessonId: "u02-bratya-i-sestry", titleRu: "Братья и сёстры", placeRu: "Шульган-Таш", unitOrder: 2 },
  { kind: "place_test", lessonId: "u02-ispytanie", titleRu: "Испытание места", placeRu: "Шульган-Таш", unitOrder: 2 },
];

type LessonPreview = Schema<"LessonPreview">;
/** Строка урока: башкирский текст, перевод и id копии записи на сайте (public/audio), если запись есть. */
type PreviewRow = [text: string, translationRu: string, audio?: string];

const previewWord = ([text, translationRu, audio]: PreviewRow): Schema<"LessonPreviewWord"> => ({
  id: text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim(),
  word: {
    text,
    review: REVIEW,
    ...(audio
      ? { audio: { origin: "native" as const, url: `/audio/${audio}.m4a`, files: [{ url: `/audio/${audio}.m4a`, type: 'audio/mp4; codecs="mp4a.40.2"' }, { url: `/audio/${audio}.ogg`, type: 'audio/ogg; codecs="vorbis"' }] } }
      : {}),
  },
  translationRu,
});

function preview(lessonId: string, kind: LessonPreview["kind"], titleRu: string, unitId: string, c: { words: PreviewRow[]; phrases: PreviewRow[]; tasks: [string, number][] }): LessonPreview {
  const unit = demoCourse().units.find((u) => u.id === unitId)!;
  const tasks = c.tasks.map(([type, count]) => ({ type, count }));
  return {
    lessonId,
    kind,
    titleRu,
    unitId,
    place: unit.place,
    topicRu: unit.topicRu,
    exerciseCount: tasks.reduce((s, t) => s + t.count, 0),
    words: c.words.map(previewWord),
    phrases: c.phrases.map(previewWord),
    tasks,
  };
}

/**
 * «Что в уроке» — как его собирает API (learning/lesson-preview.ts) из content/course: «Привет!», «Моя школа» и «Испытание
 * места» Уфы, «Погода» (u03-pogoda) и «Дни недели» (u04-dni-nedeli) — под id узлов тропы мока (mock-learn.ts).
 */
export const LESSON_PREVIEWS: Record<string, LessonPreview> = {
  "u01-privet": preview("u01-privet", "lesson", "Привет!", "01-ufa", {
    words: [["Сәләм!", "Привет!"], ["Һаумыһығыҙ!", "Здравствуйте!"]],
    phrases: [["Хәйерле иртә!", "Доброе утро!"], ["Хәйерле кис!", "Добрый вечер!"], ["Хәйерле көн!", "Добрый день!"], ["Һау бул.", "Пока!"]],
    tasks: [["choice_ba_ru", 3], ["tiles_ru_ba", 2], ["free_ru_ba", 2], ["duel", 1]],
  }),
  "u01-moya-shkola": preview("u01-moya-shkola", "lesson", "Моя школа", "01-ufa", {
    words: [["мәктәп", "школа"], ["дәфтәр", "тетрадь"], ["уҡытыусы", "учитель"], ["уҡыусы", "ученик"], ["китап", "книга"]],
    phrases: [["Тоғро дуҫ.", "Верный друг."], ["Урта мәктәп", "Средняя школа"]],
    tasks: [["tiles_ru_ba", 2], ["choice_ba_ru", 3], ["free_ru_ba", 2], ["duel", 1]],
  }),
  "u01-ispytanie": preview("u01-ispytanie", "place_test", "Испытание места", "01-ufa", {
    words: [["Һаумыһығыҙ!", "Здравствуйте!"], ["дәфтәр", "тетрадь"], ["мәктәп", "школа"]],
    phrases: [["Хәйерле иртә!", "Доброе утро!"], ["Хәлдәрегеҙ нисек?", "Как у вас дела?"], ["Тоғро дуҫ.", "Верный друг."], ["Рәхмәт, һәйбәт.", "Хорошо, спасибо."], ["Һау бул.", "Пока!"]],
    tasks: [["choice_ba_ru", 2], ["free_ru_ba", 3], ["tiles_ru_ba", 3]],
  }),
  "u03-4": preview("u03-4", "lesson", "Погода", "03-agidel", {
    words: [["ҡар", "снег", "54b65b6bcfc838ea"], ["ямғыр", "дождь"], ["ҡояш", "солнце", "2c120c70aed060ea"], ["ел", "ветер", "e5b005cc8c5e0a32"]],
    phrases: [["Епшек ҡар.", "Мокрый снег."], ["саф һауа", "чистый воздух"], ["һыуыҡ һыу", "Холодная вода"]],
    tasks: [["choice_ba_ru", 2], ["tiles_ru_ba", 3], ["free_ru_ba", 2], ["match_pairs", 1]],
  }),
  "u04-l3": preview("u04-l3", "lesson", "Дни недели", "04-yamantau", {
    words: [["дүшәмбе", "понедельник"], ["шишәмбе", "вторник"], ["шаршамбы", "среда"], ["йома", "пятница"], ["шәмбе", "суббота"], ["йәкшәмбе", "воскресенье"], ["аҙна", "неделя", "c7f81dfa611c47fc"]],
    phrases: [["был аҙнала", "На этой неделе"]],
    tasks: [["choice_ba_ru", 4], ["free_ru_ba", 2], ["tiles_ru_ba", 1], ["match_pairs", 1]],
  }),
};

const studentSeats = () => studentNumbers(demoSeats());

/** Сводка по местам — как summarize на сервере. */
export function assignmentSummary(seats: readonly AssignmentSeat[]): Schema<"AssignmentSummary"> {
  const count = (st: AssignmentSeat["status"]) => seats.filter((s) => s.status === st).length;
  return { total: seats.length, done: count("done"), late: count("done_late"), todo: count("todo"), overdue: count("overdue") };
}

/** Ближайшая пятница после сегодня (срок «до пт»). */
const fridayAhead = () => {
  const today = Date.parse(`${ufaDay()}T12:00:00Z`);
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  return ufaDay((4 - weekday + 7) % 7 || 7);
};

/** Активное задание «Моя школа» до пятницы: в демо-классе 9 из 22 сделали (у героя показа №07 — ещё нет). */
function activeLesson(students: readonly number[]): Assignment {
  const seats: AssignmentSeat[] = students.map((n) => (MY_SCHOOL_DONE.has(n) ? { seatNumber: n, status: "done", completedAt: new Date(Date.now() - n * 3_600_000).toISOString() } : { seatNumber: n, status: "todo" }));
  return { id: "0193f7a4-0000-7000-8000-0000000a5001", kind: "lesson", lessonId: "u01-moya-shkola", titleRu: "Моя школа", placeRu: "Уфа", dueOn: fridayAhead(), createdAt: new Date(Date.now() - 2 * DAY).toISOString(), active: true, summary: assignmentSummary(seats), seats };
}

/** Завершённое задание прошлой недели: сделали, сделали после срока, просрочили. */
function pastLesson(students: readonly number[]): Assignment {
  const seats: AssignmentSeat[] = students.map((n) =>
    n % 7 === 0 ? { seatNumber: n, status: "overdue" } : n % 5 === 0 ? { seatNumber: n, status: "done_late", completedAt: new Date(Date.now() - 5 * DAY).toISOString() } : { seatNumber: n, status: "done", completedAt: new Date(Date.now() - 8 * DAY).toISOString() },
  );
  return { id: "0193f7a4-0000-7000-8000-0000000a5000", kind: "lesson", lessonId: "u01-privet", titleRu: "Привет!", placeRu: "Уфа", dueOn: ufaDay(-6), createdAt: new Date(Date.now() - 10 * DAY).toISOString(), active: false, summary: assignmentSummary(seats), seats };
}

export interface AssignmentsWorld {
  active: Assignment[];
  past: Assignment[];
}

/** Задания класса — по его ученикам (места с аккаунтом), как listClassAssignments на API. */
export function demoAssignmentsWorld(students: readonly number[] = studentSeats()): AssignmentsWorld {
  return { active: [activeLesson(students)], past: [pastLesson(students)] };
}

/** Новое задание из запроса учителя: все ученики — «ещё нет». */
export function newAssignment(body: Schema<"CreateAssignmentRequest">, n: number, students: readonly number[] = studentSeats()): Assignment {
  const option = ASSIGNMENT_OPTIONS.find((o) => o.lessonId === body.lessonId);
  const seats: AssignmentSeat[] = students.map((s) => ({ seatNumber: s, status: "todo" }));
  return {
    id: `0193f7a4-0000-7000-8000-0000000a51${String(n).padStart(2, "0")}`,
    kind: body.kind,
    ...(body.kind === "review" ? { titleRu: "Повторить слова" } : { lessonId: body.lessonId!, titleRu: option?.titleRu ?? body.lessonId!, placeRu: option?.placeRu ?? "Уфа" }),
    dueOn: body.dueOn,
    createdAt: new Date().toISOString(),
    active: true,
    summary: assignmentSummary(seats),
    seats,
  } as Assignment;
}

/** Карточка ученика по месту: №07 — герой показа; остальные — по прогрессу места. */
export function demoSeatCard(classId: string, seat: number, classSeats: readonly Seat[] = demoSeats()): Schema<"SeatProgressCard"> | undefined {
  const p = demoSeatProgress(studentNumbers(classSeats)).find((x) => x.seatNumber === seat);
  if (!classSeats.find((s) => s.number === seat)?.student) return undefined;
  const all: Schema<"SeatLessonDone">[] = [
    { lessonId: "u01-privet", kind: "lesson", titleRu: "Привет!", placeRu: "Уфа", completions: 2, bestAccuracy: 0.92, lastCompletedOn: ufaDay(-3) },
    { lessonId: "u01-kak-tebya-zovut", kind: "lesson", titleRu: "Как вас зовут?", placeRu: "Уфа", completions: 1, bestAccuracy: 0.8, lastCompletedOn: ufaDay(-1) },
    { lessonId: "u01-moya-shkola", kind: "lesson", titleRu: "Моя школа", placeRu: "Уфа", completions: 1, bestAccuracy: 0.86, lastCompletedOn: ufaDay() },
  ];
  const lessons = all.slice(0, Math.max(0, Math.min(3, p?.lessonsCompleted ?? 0)));
  return {
    classId,
    seatNumber: seat,
    lessonsCompleted: p?.lessonsCompleted ?? 0,
    wordsLearned: p?.wordsLearned ?? 0,
    ...(p?.accuracy !== undefined ? { accuracy: p.accuracy } : {}),
    streak: { current: p?.streak ?? 0, longest: Math.max(p?.streak ?? 0, 7) },
    votes: { total: seat === 7 ? 9 : 4, matured: seat === 7 ? 5 : 2 },
    honey: seat === 7 ? 214 : 120 + seat * 3,
    ...(p?.lastActiveOn ? { lastActiveOn: p.lastActiveOn } : {}),
    lessons,
    recentDays: p?.lastActiveOn ? [0, 1, 2].map((d) => ({ date: ufaDay(-d), lessons: d === 0 ? 2 : 1, honey: d === 0 ? 26 : 12 })) : [],
  };
}

export interface TeacherWorld {
  /** Прогресс класса по его местам (ученики — места с аккаунтом, как у API); без мест — демо-класс 5 «Б». */
  progress: (classId: string, seats?: readonly Seat[]) => Schema<"ClassProgress">;
  assignments: AssignmentsWorld;
  items: MockItem[];
  /** Голоса учителя (журнал «только вставка»): itemId → запрос и ответ. */
  judgments: Map<string, { body: JudgmentRequest; votes: CorpusItemVotes }>;
}

export function teacherWorld(): TeacherWorld {
  return { progress: demoClassProgress, assignments: demoAssignmentsWorld(), items: demoItems(), judgments: new Map() };
}

const WEIGHT: Record<Group, number> = { child: 1, adult: 2, teacher: 3 };

const majority = (t: { a: number; b: number }): "a" | "b" | null => (t.a > t.b ? "a" : t.b > t.a ? "b" : null);

/**
 * duel-v0 «сервера» мока — упрощённо, как в векторах consensus/duel-v0: веса 1/2/3, «оба» —
 * по 0,5 обоим; без учителей и взрослых — voting; большинства учителей и взрослых расходятся — escalated; иначе при ≥ 3
 * голосах и перевесе ≥ 2 — accepted; большинство детей не совпало с итогом — children_prefer. Настоящие правила — в модуле consensus API.
 */
export function tallyVotes(item: MockItem, mine: JudgmentRequest | null, votedAt: string): CorpusItemVotes {
  const groups = structuredClone(item.base);
  if (mine) groups.teacher[mine.choice] += 1;
  const [va, vb] = item.duel.variants as [Schema<"DuelVariant">, Schema<"DuelVariant">];
  const elder = groups.teacher.a + groups.teacher.b + groups.teacher.both + groups.adult.a + groups.adult.b + groups.adult.both;
  let wa = 0;
  let wb = 0;
  let count = 0;
  for (const g of ["child", "adult", "teacher"] as Group[]) {
    const t = groups[g];
    wa += WEIGHT[g] * (t.a + t.both / 2);
    wb += WEIGHT[g] * (t.b + t.both / 2);
    count += t.a + t.b + t.both;
  }
  const tm = majority(groups.teacher);
  const am = majority(groups.adult);
  let status: Schema<"ItemStatus"> = "voting";
  let winner: "a" | "b" | null = null;
  if (elder > 0) {
    if (tm && am && tm !== am) status = "escalated";
    else if (count >= 3 && Math.abs(wa - wb) >= 2) {
      status = "accepted";
      winner = wa > wb ? "a" : "b";
    }
  }
  const cm = majority(groups.child);
  const tally = (g: Group): GroupTally => {
    const t = groups[g];
    return { total: t.a + t.b + t.both + t.skip, both: t.both, skip: t.skip, variants: [{ variantId: va.variantId, votes: t.a }, { variantId: vb.variantId, votes: t.b }] };
  };
  const variant = (v: Schema<"DuelVariant">, key: "a" | "b"): Schema<"VotedVariant"> => ({
    variantId: v.variantId,
    text: v.text,
    accepted: winner === key,
    main: winner === key,
    tags: winner && cm === key && cm !== winner ? ["children_prefer"] : [],
  });
  // Порядок shown у голоса — относительно показа: в моке показ всегда в порядке variants (A, B).
  const myVariant = mine && (mine.choice === "a" || mine.choice === "b") ? mine.shown[mine.choice === "a" ? 0 : 1] : undefined;
  return {
    itemId: item.duel.itemId,
    sourceRu: item.duel.sourceRu,
    status,
    ...(winner ? { decidedBy: "rule" as const } : {}),
    variants: [variant(va, "a"), variant(vb, "b")],
    groups: { child: tally("child"), teacher: tally("teacher"), adult: tally("adult") },
    ...(mine ? { myVote: { choice: mine.choice, ...(myVariant ? { variantId: myVariant } : {}), votedAt } } : {}),
    rulesVersion: "duel-v0",
  };
}
