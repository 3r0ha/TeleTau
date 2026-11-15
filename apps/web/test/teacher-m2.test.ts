// Кабинет учителя — чистые функции экранов «Прогресс» и «Помогите языку» и «Назад» Mini App.
import { describe, expect, it } from "vitest";
import type { Schema } from "@teletau/contracts";
import { backAction, isSheetEntry } from "../app/_components/telegram/miniapp-nav";
import { currentPlaceIndex, lastActiveLabel, percent, placeGroups, studentRows, studentSummary, ufaToday, weekLabel, weekSummary } from "../app/teacher/classes/[id]/progress/model";
import { barPieces, letterOf, segmentsOf, statusText } from "../app/teacher/duels/votes";
import { tFor } from "../i18n/registry";

const t = tFor("ru");

const seat = (number: number, nickname?: string): Schema<"Seat"> => ({
  number,
  cardStatus: "active",
  cardVersion: 1,
  ...(nickname ? { student: { accountId: `acc-${number}`, nickname, joinedAt: "2026-11-01T00:00:00Z" } } : {}),
});
const progress = (seatNumber: number, extra: Partial<Schema<"SeatProgress">> = {}): Schema<"SeatProgress"> => ({
  seatNumber,
  lessonsCompleted: 3,
  wordsLearned: 12,
  lessonsThisWeek: 2,
  honeyThisWeek: 24,
  streak: 6,
  lastActiveOn: "2026-11-14",
  ...extra,
});

describe("«Прогресс»: склейка мест и прогресса", () => {
  it("ученики по номерам мест: ники — со страницы класса, пустые места — нет, новичок из прогресса — без ника", () => {
    const rows = studentRows([seat(7, "Смелая пчела"), seat(1, "Ловкий шмель"), seat(2)], [progress(7), progress(9)]);
    expect(rows.map((r) => [r.seatNumber, r.nickname, Boolean(r.progress)])).toEqual([
      [1, "Ловкий шмель", false],
      [7, "Смелая пчела", true],
      [9, null, true],
    ]);
  });

  it("«3 урока · сегодня», «вчера», дата; ещё не занимался — «Уроков пока нет»", () => {
    expect(studentSummary(progress(7), "2026-11-14", t)).toBe("3 урока · сегодня");
    expect(studentSummary(progress(7, { lessonsCompleted: 1, lastActiveOn: "2026-11-13" }), "2026-11-14", t)).toBe("1 урок · вчера");
    expect(studentSummary(progress(7, { lessonsCompleted: 5, lastActiveOn: "2026-11-02" }), "2026-11-14", t)).toBe("5 уроков · 2 ноября");
    expect(studentSummary(null, "2026-11-14", t)).toBe("Уроков пока нет");
    expect(lastActiveLabel(undefined, "2026-11-14", t)).toBeNull();
  });

  it("неделя ученика и класса", () => {
    expect(weekSummary(progress(7, { lessonsThisWeek: 3, honeyThisWeek: 36, accuracy: 0.857 }), t)).toBe("На неделе: 3 урока · 36 мёда · точность 86%");
    expect(weekSummary(progress(7, { lessonsThisWeek: 0 }), t)).toBe("На неделе без уроков");
    expect(weekLabel({ start: "2026-11-09", end: "2026-11-15" }, t)).toBe("9–15 ноября");
    expect(weekLabel({ start: "2026-11-30", end: "2026-12-06" }, t)).toBe("30 ноября – 6 декабря");
    expect(percent(1.2)).toBe("100%");
  });

  it("сутки — по Уфе (UTC+5): 20:00 UTC — уже следующий день", () => {
    expect(ufaToday(Date.parse("2026-11-14T18:59:00Z"))).toBe("2026-11-14");
    expect(ufaToday(Date.parse("2026-11-14T19:00:00Z"))).toBe("2026-11-15");
  });
});

describe("«Прохождение уроков» по местам тропы", () => {
  const unit = (id: string, order: number, titleRu: string): Schema<"ClassProgressUnit"> => ({ id, order, place: { slug: id, titleRu }, topicRu: "Тема" });
  const lesson = (lessonId: string, unitId: string | undefined, completedSeats: number): Schema<"LessonCompletion"> => ({ lessonId, titleRu: lessonId, completedSeats, ...(unitId ? { unitId } : {}) });
  const units = [unit("02-shulgantash", 2, "Шульган-Таш"), unit("01-ufa", 1, "Уфа"), unit("03-agidel", 3, "Агидель")];

  it("уроки — по местам в порядке тропы; доля — прохождения / (уроков × учеников), сверх учеников не считается", () => {
    const groups = placeGroups({ units, lessons: [lesson("a", "01-ufa", 20), lesson("b", "01-ufa", 10), lesson("c", "02-shulgantash", 0), lesson("d", "03-agidel", 5)] }, 10);
    expect(groups.map((g) => [g.key, g.lessons.map((l) => l.lessonId), g.share])).toEqual([
      ["01-ufa", ["a", "b"], 1],
      ["02-shulgantash", ["c"], 0],
      ["03-agidel", ["d"], 0.5],
    ]);
  });

  it("без units (старый ответ API) — одна группа без места; место без уроков не показывается", () => {
    expect(placeGroups({ lessons: [lesson("a", undefined, 1)] }, 2).map((g) => [g.key, g.unit])).toEqual([["lessons", null]]);
    expect(placeGroups({ units, lessons: [lesson("a", "01-ufa", 1)] }, 2).map((g) => g.key)).toEqual(["01-ufa"]);
  });

  it("класс — у следующего урока после самого дальнего, который прошла половина; никто — первое место; все — последнее", () => {
    const at = (counts: number[][]) =>
      currentPlaceIndex(
        placeGroups({ units, lessons: counts.flatMap((c, u) => c.map((n, i) => lesson(`${u}-${i}`, units.map((x) => x.id).sort()[u], n))) }, 22),
        22,
      );
    expect(at([[19, 15, 9, 3, 0], [0, 0], [0]])).toBe(0);
    // Испытание Уфы прошли немногие, но большинство уже в Шульган-Таше.
    expect(at([[20, 20, 4], [12, 3], [0]])).toBe(1);
    // Уфу прошли все — класс у первого урока Шульган-Таша.
    expect(at([[22, 22], [0, 0], [0]])).toBe(1);
    expect(at([[0, 0], [0], [0]])).toBe(0);
    expect(at([[14, 14], [14], [14]])).toBe(2);
    expect(currentPlaceIndex([], 22)).toBe(-1);
  });
});

const tally = (a: number, b: number, both = 0, skip = 0): Schema<"GroupTally"> => ({
  total: a + b + both + skip,
  both,
  skip,
  variants: [
    { variantId: "vb", votes: b },
    { variantId: "va", votes: a },
  ],
});

describe("«Помогите языку»: голоса по группам", () => {
  it("счёт в порядке показа A, B, «оба», «не знаю» — по variantId, а не по порядку в ответе", () => {
    expect(segmentsOf(tally(6, 2, 1, 1), ["va", "vb"], t).map((s) => [s.label, s.count])).toEqual([
      ["A", 6],
      ["B", 2],
      ["оба", 1],
      ["не знаю", 1],
    ]);
    expect(letterOf("vb", ["va", "vb"])).toBe("B");
  });

  it("полоса: доли без пустых кусков, сумма — 100%; голосов нет — пусто", () => {
    const pieces = barPieces(segmentsOf(tally(6, 2, 0, 2), ["va", "vb"], t));
    expect(pieces.map((p) => [p.key, p.x, p.width])).toEqual([
      ["a", 0, 60],
      ["b", 60, 20],
      ["skip", 80, 20],
    ]);
    expect(barPieces(segmentsOf(tally(0, 0), ["va", "vb"], t))).toEqual([]);
  });

  it("пояснение статуса словами продукта — без правил подсчёта и «эксперта»", () => {
    const base: Schema<"CorpusItemVotes"> = {
      itemId: "i",
      sourceRu: "Здравствуйте!",
      status: "accepted",
      decidedBy: "rule",
      variants: [
        { variantId: "vb", text: "B", accepted: false, main: false, tags: [] },
        { variantId: "va", text: "A", accepted: true, main: true, tags: [] },
      ],
      groups: { child: tally(1, 0), adult: tally(1, 0), teacher: tally(1, 0) },
      rulesVersion: "duel-v0",
    };
    expect(statusText(base, ["va", "vb"], t)).toBe("Вариант A вошёл в словарь.");
    expect(statusText({ ...base, decidedBy: "expert" }, ["vb", "va"], t)).toBe("Вариант B вошёл в словарь.");
    expect(statusText({ ...base, status: "escalated" }, ["va", "vb"], t)).toBe("Голоса разделились — пару посмотрят ещё раз.");
    expect(statusText({ ...base, status: "voting" }, ["va", "vb"], t)).toBe("Итог появится, когда проголосуют другие.");
    for (const status of ["accepted", "escalated", "voting"] as const) {
      expect(statusText({ ...base, status }, ["va", "vb"], t)).not.toMatch(/эксперт|правил|duel-v0|основн/i);
    }
  });
});

describe("Mini App: системная «Назад»", () => {
  const paths = {
    prefix: "/miniapp",
    learn: "/miniapp/learn",
    league: "/miniapp/league",
    board: "/miniapp/board",
    hive: "/miniapp/hive",
    me: "/miniapp/me",
    words: "/miniapp/me/words",
    review: "/miniapp/learn?review=1",
    login: "/miniapp/student",
    nickname: "/miniapp/student/nickname",
    code: "/miniapp/student/code",
    loginEmail: "/miniapp/student/email",
    wait: "/miniapp/student/wait",
    joined: "/miniapp/student/class",
    start: "/miniapp",
  };

  it("тропа, вход, ник, «Ты в классе» — без кнопки; вкладки — на тропу; код класса и «Мой словарь» — назад по истории; лист — закрыть", () => {
    expect(backAction("/miniapp/learn", paths, false)).toBe("none");
    expect(backAction("/miniapp/student", paths, false)).toBe("none");
    expect(backAction("/miniapp/student/nickname", paths, false)).toBe("none");
    expect(backAction("/miniapp/student/class", paths, false)).toBe("none");
    expect(backAction("/miniapp/league", paths, false)).toBe("trail");
    expect(backAction("/miniapp/board", paths, false)).toBe("trail");
    expect(backAction("/miniapp/me/", paths, false)).toBe("trail");
    expect(backAction("/miniapp/student/code", paths, false)).toBe("history");
    expect(backAction("/miniapp/me/words", paths, false)).toBe("history");
    expect(backAction("/miniapp/learn", paths, true)).toBe("history");
  });

  it("лист узнаётся по метке записи истории packages/ui (sheetHistory)", () => {
    expect(isSheetEntry({ __NA: true, ttSheet: "sheet-1" })).toBe(true);
    expect(isSheetEntry({ __NA: true })).toBe(false);
    expect(isSheetEntry(null)).toBe(false);
  });
});
