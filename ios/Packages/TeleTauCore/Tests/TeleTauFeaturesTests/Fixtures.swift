import Foundation
@testable import TeleTauAPI
@testable import TeleTauFeatures
@testable import TeleTauSession

// Данные экранов — как в демо-мире (docs/demo/M2.md): ученик №07 «Смелая пчела», 5 «Б», урок «Моя школа».
// Башкирские строки — посимвольно из content/ (course/ba-ru, corpus/duels): в тестах они изображают ответ API.

typealias S = Components.Schemas

enum Fixture {
    static func ba(_ s: String) -> S.BaString { .init(text: s, review: .needsNativeReview) }

    static let me = S.Me(
        id: "7f0d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f", kind: .child, roles: [.student], nickname: "Смелая пчела", uiMode: .bortnik,
        locale: .ru, teacherStatus: .none, classes: [.init(id: "1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5", title: "5 «Б»", schoolName: "Демо-школа № 1", role: .student, seatNumber: 7)],
        pendingConsents: []
    )

    static let course = S.Course(id: "ba-ru", contentVersion: 1, units: [
        .init(id: "01-ufa", order: 1, state: .open, place: .init(slug: "ufa", titleRu: "Уфа", titleBa: ba("Өфө")), topicRu: "Знакомство", nodes: [
            .init(id: "u01-privet", kind: .lesson, state: .done, titleRu: "Привет!", icon: .star),
            .init(id: "u01-kak-tebya-zovut", kind: .lesson, state: .done, titleRu: "Как вас зовут?", icon: .chatCircleText),
            .init(id: "u01-help-1", kind: .helpLanguage, state: .done, titleRu: "Помоги языку"),
            .init(id: "u01-moya-shkola", kind: .lesson, state: .current, titleRu: "Моя школа", icon: .bookOpen),
            .init(id: "u01-vezhlivye-slova", kind: .lesson, state: .locked, titleRu: "Вежливые слова", icon: .barbell),
            .init(id: "u01-help-2", kind: .helpLanguage, state: .locked, titleRu: "Помоги языку"),
            .init(id: "u01-ispytanie", kind: .placeTest, state: .locked, titleRu: "Испытание места"),
        ]),
        .init(id: "02-shulgantash", order: 2, state: .locked, place: .init(slug: "shulgantash", titleRu: "Шульган-Таш", titleBa: ba("Шүлгәнташ")), topicRu: "Семья", nodes: [
            .init(id: "u02-1", kind: .lesson, state: .locked, titleRu: "Мама и папа", icon: .star),
            .init(id: "u02-2", kind: .lesson, state: .locked, titleRu: "Братья и сёстры", icon: .chatCircleText),
            .init(id: "u02-help", kind: .helpLanguage, state: .locked, titleRu: "Помоги языку"),
            .init(id: "u02-3", kind: .lesson, state: .locked, titleRu: "Мой дом", icon: .bookOpen),
        ]),
        .init(id: "03-agidel", order: 3, state: .locked, place: .init(slug: "agidel", titleRu: "Агидель", titleBa: ba("Ағиҙел")), topicRu: "Природа", nodes: [
            .init(id: "u03-1", kind: .lesson, state: .locked, titleRu: "Река", icon: .star),
            .init(id: "u03-2", kind: .lesson, state: .locked, titleRu: "Лес и горы", icon: .chatCircleText),
        ]),
    ], review: .init(due: 3))

    static func week(today: String = "2026-11-05", doneThrough: Int = 3) -> S.StreakState {
        let dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]
        let days: [S.StreakDay] = dates.enumerated().map { i, d in
            .init(date: d, status: i < doneThrough ? .done : d == today ? .today : .future)
        }
        return .init(current: 5, longest: 9, freezes: 2, extendedToday: false, today: today, week: days)
    }

    static let progress = S.MyProgress(
        honey: .init(total: 245, pending: 6), streak: week(),
        dailyGoal: .init(target: 2, done: 1, met: false),
        league: .init(tier: .fireweed, points: 120, rank: 6),
        lessonsCompleted: 3, wordsLearned: 18, votes: .init(total: 7, matured: 5, pending: 2)
    )

    /// Новый ученик: ни одного урока — показывается знакомство с пчелой.
    static let progressNew = S.MyProgress(
        honey: .init(total: 0, pending: 0), streak: .init(current: 0, longest: 0, freezes: 0, extendedToday: false, today: "2026-11-05", week: week(doneThrough: 0).week),
        dailyGoal: .init(target: 2, done: 0, met: false),
        league: nil, lessonsCompleted: 0, wordsLearned: 0, votes: .init(total: 0, matured: 0, pending: 0)
    )

    static let started = Date(timeIntervalSince1970: 1_793_840_000)

    static let tiles = S.RunExercise.tilesRuBa(.init(id: "e01", _type: .tilesRuBa, review: .needsNativeReview, promptRu: "Средняя школа", tiles: [
        .init(id: "t1", text: "мәктәп"), .init(id: "t2", text: "китап"), .init(id: "t3", text: "Урта"), .init(id: "t4", text: "дәрес"),
    ]))
    /// Запись носителя: относительный адрес на сайте (AAC — играет iOS) и ссылка на Ogg (не играет — кнопки нет).
    static let m4a = S.AudioClip(url: "/audio/063d0f07d15ef02e.m4a")
    static let ogg = S.AudioClip(url: "https://upload.wikimedia.org/wikipedia/commons/0/02/Ba-example.ogg")

    static let choice = S.RunExercise.choiceBaRu(.init(id: "e02", _type: .choiceBaRu, review: .needsNativeReview, prompt: "мәктәп", promptAudio: m4a, options: [
        .init(id: "o1", textRu: "школа"), .init(id: "o2", textRu: "книга"), .init(id: "o3", textRu: "учитель"), .init(id: "o4", textRu: "урок"),
    ]))
    static let free = S.RunExercise.freeRuBa(.init(id: "e03", _type: .freeRuBa, review: .needsNativeReview, promptRu: "тетрадь",
                                                   letters: ["ә", "ө", "ү", "ғ", "ҡ", "ң", "ҙ", "ҫ", "һ"]))
    static let duel = S.RunExercise.duel(.init(id: "e04", _type: .duel, review: .needsNativeReview, itemId: "5b8c2a10-0f3e-4c1a-9d2b-7e6f5a4b3c21",
                                               sourceRu: "Здравствуйте!", a: "Һаумыһығыҙ!", b: "Иҫәнмеһегеҙ!"))
    static let pairs = S.RunExercise.matchPairs(.init(id: "e05", _type: .matchPairs, review: .needsNativeReview,
                                                      left: [.init(id: "l1", text: "мәктәп"), .init(id: "l2", text: "дәфтәр"), .init(id: "l3", text: "китап"), .init(id: "l4", text: "уҡытыусы")],
                                                      right: [.init(id: "r1", textRu: "книга"), .init(id: "r2", textRu: "учитель"), .init(id: "r3", textRu: "школа"), .init(id: "r4", textRu: "тетрадь")]))

    static let run = S.LessonRun(runId: "0193f0a2-7c00-7000-8000-000000000001", lessonId: "u01-moya-shkola", kind: .lesson, titleRu: "Моя школа",
                                 status: .active, startedAt: started, exercises: [tiles, choice, free, duel, pairs])

    /// «Новое слово» перед упражнениями (`accepts: [word_intro]`) и подсказки к словам условия.
    static let introSchool = S.RunExercise.wordIntro(.init(id: "w01", _type: .wordIntro, review: .needsNativeReview,
                                                           word: .init(text: "мәктәп", review: .needsNativeReview, audio: m4a), translationRu: "школа"))
    static let introLong = S.RunExercise.wordIntro(.init(id: "w02", _type: .wordIntro, review: .needsNativeReview,
                                                         word: ba("уҡытыусы"), translationRu: "учитель"))
    static let tilesHinted = S.RunExercise.tilesRuBa(.init(id: "e11", _type: .tilesRuBa, review: .needsNativeReview, promptRu: "Средняя школа",
                                                           hints: [.init(text: "Средняя", translation: ba("урта")), .init(text: "школа", translation: ba("мәктәп"))],
                                                           tiles: [.init(id: "t1", text: "мәктәп"), .init(id: "t2", text: "китап"), .init(id: "t3", text: "Урта"), .init(id: "t4", text: "дәрес")]))
    static let freeHinted = S.RunExercise.freeRuBa(.init(id: "e13", _type: .freeRuBa, review: .needsNativeReview, promptRu: "тетрадь",
                                                         hints: [.init(text: "тетрадь", translation: ba("дәфтәр"))],
                                                         letters: ["ә", "ө", "ү", "ғ", "ҡ", "ң", "ҙ", "ҫ", "һ"]))
    static let introRun = S.LessonRun(runId: "0193f0a2-7c00-7000-8000-000000000002", lessonId: "u01-moya-shkola", kind: .lesson, titleRu: "Моя школа",
                                      status: .active, startedAt: started, exercises: [introSchool, introLong, tilesHinted, choice, freeHinted])

    static func introLesson(at index: Int) -> LessonState {
        var l = LessonState(run: introRun, node: NodeRef(id: introRun.lessonId, kind: .lesson), startedAt: started)
        let ids = introRun.exercises.map(\.exerciseId)
        l.finished = Array(ids[..<index])
        l.queue = Array(ids[index...])
        return l
    }

    /// Урок на упражнении `index`: пройдены предыдущие, текущее — первое в очереди.
    static func lesson(at index: Int, feedback: S.AttemptResult? = nil, retry: Bool = false) -> LessonState {
        var l = LessonState(run: run, node: NodeRef(id: run.lessonId, kind: .lesson), startedAt: started)
        let ids = run.exercises.map(\.exerciseId)
        l.finished = Array(ids[..<index])
        l.queue = Array(ids[index...])
        if retry { l.shownBefore[ids[index]] = 1 }
        l.feedback = feedback
        return l
    }

    static let almost = S.AttemptResult(attemptId: "a3", exerciseId: "e03", verdict: .almost, firstAttempt: true, retry: false,
                                        correctAnswer: .init(text: "дәфтәр", review: .needsNativeReview, audio: m4a), meaningRu: "тетрадь", hint: .init(expected: "ә", got: "а", token: 0, index: 1))
    static let wrongChoice = S.AttemptResult(attemptId: "a2", exerciseId: "e02", verdict: .wrong, firstAttempt: true, retry: true,
                                             correctOptionId: "o1", meaningRu: "школа")
    static let voted = S.AttemptResult(attemptId: "a4", exerciseId: "e04", verdict: .recorded, firstAttempt: true, retry: false)
    static let correctTiles = S.AttemptResult(attemptId: "a1", exerciseId: "e01", verdict: .correct, firstAttempt: true, retry: false,
                                              correctAnswer: .init(text: "Урта мәктәп", review: .needsNativeReview), meaningRu: "Средняя школа")
    static let wrongTiles = S.AttemptResult(attemptId: "a1", exerciseId: "e01", verdict: .wrong, firstAttempt: true, retry: true,
                                            correctAnswer: .init(text: "Урта мәктәп", review: .needsNativeReview), meaningRu: "Средняя школа")
    /// Первый урок: всё впереди — тропа под знакомством с пчелой.
    static var courseNew: S.Course {
        var c = course
        c.review = nil
        for u in c.units.indices {
            for n in c.units[u].nodes.indices {
                c.units[u].nodes[n].state = u == 0 && n == 0 ? .current : .locked
            }
        }
        return c
    }

    static let summary = S.LessonRunSummary(
        runId: run.runId, lessonId: run.lessonId,
        honey: .init(total: 18, base: 10, firstTry: 8, multiplier: 1, pendingFromVotes: 3),
        accuracy: 0.92, durationSeconds: 161, newWords: [ba("мәктәп"), ba("дәфтәр"), ba("уҡытыусы"), ba("китап")], votes: 1,
        streak: { var s = week(doneThrough: 4); s.current = 6; s.extendedToday = true; return s }(),
        leagueResult: .init(weekStart: "2026-10-26", tierBefore: .sweetclover, tierAfter: .fireweed, outcome: .promoted, rank: 4, points: 312),
        dailyGoal: .init(target: 2, done: 2, met: true), dailyGoalReached: true
    )

    static let league = S.LeagueStanding(
        week: .init(start: "2026-11-02", end: "2026-11-08"), endsAt: Date(timeIntervalSince1970: 1_794_092_400), tier: .fireweed,
        zones: .init(promote: 5, demote: 3),
        members: [
            .init(rank: 1, nickname: "Ловкий шмель", points: 412, me: false, zone: .promote),
            .init(rank: 2, nickname: "Тихая сова", points: 388, me: false, zone: .promote),
            .init(rank: 3, nickname: "Быстрая белка", points: 351, me: false, zone: .promote),
            .init(rank: 4, nickname: "Ясный родник", points: 330, me: false, zone: .promote),
            .init(rank: 5, nickname: "Смелая пчела", points: 318, me: true, zone: .promote),
            .init(rank: 6, nickname: "Звонкий журавль", points: 244, me: false, zone: .stay),
            .init(rank: 7, nickname: "Добрый барсук", points: 201, me: false, zone: .stay),
            .init(rank: 8, nickname: "Мудрая сова", points: 120, me: false, zone: .demote),
            .init(rank: 9, nickname: "Весёлый ёж", points: 90, me: false, zone: .demote),
        ]
    )
    static let leagueNow = Date(timeIntervalSince1970: 1_793_840_000)

    static let hive = S.ClassHive(
        classId: "1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5", week: .init(start: "2026-11-02", end: "2026-11-08"),
        quest: .init(titleRu: "Пройдите всем классом 60 уроков", goal: 60, progress: 41, completed: false),
        participation: .init(active: 18, total: 24),
        days: [.init(date: "2026-11-02", active: 12), .init(date: "2026-11-03", active: 15), .init(date: "2026-11-04", active: 9),
               .init(date: "2026-11-05", active: 4), .init(date: "2026-11-06", active: 0), .init(date: "2026-11-07", active: 0), .init(date: "2026-11-08", active: 0)]
    )

    /// Курс с заданиями учителя: одно активное (урок «Моя школа», до пятницы) и одно выполненное.
    static let courseWithTasks: S.Course = {
        var c = course
        c.assignments = [
            .init(id: "6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d", kind: .lesson, lessonId: "u01-moya-shkola", titleRu: "Моя школа", placeRu: "Уфа", dueOn: "2026-11-06", done: false),
            .init(id: "6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4e", kind: .lesson, lessonId: "u01-privet", titleRu: "Привет!", placeRu: "Уфа", dueOn: "2026-11-05", done: true),
        ]
        return c
    }()

    /// Первый экран тропы: одно задание учителя (урок «Моя школа», до завтра) и повторение.
    static let courseToday: S.Course = {
        var c = course
        c.assignments = [courseWithTasks.assignments![0]]
        return c
    }()

    /// Уфа пройдена, в Шульган-Таше пройдены два урока, сейчас — «Помоги языку».
    static let courseSecondPlace: S.Course = {
        var c = course
        for n in c.units[0].nodes.indices { c.units[0].nodes[n].state = .done }
        c.units[1].state = .open
        for n in c.units[1].nodes.indices { c.units[1].nodes[n].state = n < 2 ? .done : n == 2 ? .current : .locked }
        return c
    }()

    /// «Мой словарь»: слова урока «Моя школа» и знакомства; у одного — запись AAC, у другого — Ogg (кнопки нет).
    static let words = S.MyWords(summary: .init(total: 5, learned: 3, review: 2), words: [
        .init(id: "мәктәп", word: .init(text: "мәктәп", review: .needsNativeReview, audio: m4a), translationRu: "школа", status: .review),
        .init(id: "дәфтәр", word: ba("дәфтәр"), translationRu: "тетрадь", status: .review),
        .init(id: "сәләм", word: .init(text: "Сәләм!", review: .needsNativeReview, audio: ogg), translationRu: "Привет!", status: .learned),
        .init(id: "китап", word: ba("китап"), translationRu: "книга", status: .learned),
        .init(id: "уҡытыусы", word: ba("уҡытыусы"), translationRu: "учитель", status: .learned),
    ])

    /// «Учусь сам»: ученик 11–14 лет без класса, карточка входа выпущена.
    static let meSolo = S.Me(
        id: "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182", kind: .child, roles: [.student], nickname: "Мудрая сова", uiMode: .bortnik,
        ageBand: .age1114, dailyGoal: 2, loginCard: .issued, locale: .ru, teacherStatus: .none, classes: [], pendingConsents: []
    )
    static let meAdult = S.Me(
        id: "3c4d5e6f-7081-4b92-8c3d-4e5f60718293", kind: .adult, roles: [], nickname: "Ясный родник", uiMode: .keeper,
        ageBand: .adult, loginCard: S.LoginCardStatus.none, locale: .ru, teacherStatus: .none, classes: [], pendingConsents: []
    )
    /// Личная карточка (векторы login-card, p001).
    static let loginCard = S.LoginCard(payload: "TP1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.4S", version: 1, issuedAt: started)
    static let nicks: [S.NicknameSuggestion] = [
        .init(id: "adj-01.noun-01", text: "Смелая пчела"), .init(id: "adj-02.noun-02", text: "Ловкий шмель"), .init(id: "adj-03.noun-03", text: "Тихая сова"),
    ]
    static let joinTicket = S.ClassJoinTicket(requestId: "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d", status: .pending, expiresAt: started.addingTimeInterval(900),
                                              pollIntervalSeconds: 3, _class: .init(title: "5 «Б»", grade: 5, letter: "Б"))

    static let cells = S.MyCellsPage(summary: .init(matured: 5, pending: 2, honeyFinal: 13, honeyPending: 6), items: [])
}

// MARK: - Испытание для перехода («Уже знаешь?»)

extension Fixture {
    static let jumpUnitId = "02-shulgantash"

    /// Шульган-Таш открыт как юнит, но уроки Уфы пройдены не все: место закрыто, у вывески — «Уже знаешь?».
    static let courseJump: S.Course = {
        var c = course
        c.units[1].state = .open
        c.units[1].jump = .init(exerciseCount: 8, mistakesAllowed: 2)
        for n in c.units[1].nodes.indices { c.units[1].nodes[n].exerciseCount = 12 }
        return c
    }()

    /// После сданного испытания: непройденные уроки Уфы засчитаны (`passedByTest`), в Шульган-Таше — текущий урок.
    static let courseJumped: S.Course = {
        var c = courseJump
        c.units[1].jump = nil
        for n in c.units[0].nodes.indices where c.units[0].nodes[n].state != .done {
            let graded = c.units[0].nodes[n].kind != .helpLanguage
            c.units[0].nodes[n].state = graded ? .done : .open
            c.units[0].nodes[n].passedByTest = graded ? true : nil
            c.units[0].nodes[n].completions = 0
        }
        c.units[1].nodes[0].state = .current
        return c
    }()

    static let jumpRun = S.LessonRun(runId: "0193f0a2-7c00-7000-8000-000000000003", lessonId: jumpUnitId, kind: .jump, titleRu: "Испытание",
                                     status: .active, startedAt: started, exercises: [tiles, choice, free])

    static func jumpSummary(passed: Bool) -> S.LessonRunSummary {
        .init(runId: jumpRun.runId, lessonId: jumpUnitId,
              honey: .init(total: passed ? 20 : 0, base: passed ? 20 : 0, firstTry: 0, multiplier: 1, pendingFromVotes: 0),
              accuracy: passed ? 0.88 : 0.38, durationSeconds: 142, newWords: [], votes: 0, streak: week(),
              dailyGoal: .init(target: 2, done: passed ? 2 : 1, met: passed), dailyGoalReached: passed ? true : nil,
              jump: .init(unitId: jumpUnitId, passed: passed, mistakes: passed ? 1 : 3, mistakesAllowed: 2))
    }
}

// MARK: - Награды

extension Fixture {
    /// Награды набора — тексты как у сервера (apps/api/src/modules/learning/achievements.ts): id, название, что сделать,
    /// значок, сколько нужно.
    static let awardSet: [(id: String, title: String, text: String, icon: String, target: Int)] = [
        ("first-lesson", "Первый урок", "Пройди первый урок", "footprints", 1),
        ("perfect-lesson", "Без ошибок", "Пройди урок без ошибок", "seal-check", 1),
        ("streak-3", "3 дня подряд", "Занимайся 3 дня подряд", "fire", 3),
        ("streak-7", "7 дней подряд", "Занимайся 7 дней подряд", "fire", 7),
        ("streak-30", "30 дней подряд", "Занимайся 30 дней подряд", "fire", 30),
        ("goal-7", "7 целей дня", "Выполни цель дня 7 раз", "target", 7),
        ("words-10", "10 слов", "Выучи 10 слов", "book-open", 10),
        ("words-50", "50 слов", "Выучи 50 слов", "books", 50),
        ("first-vote", "Первый голос", "Проголосуй в «Помоги языку»", "scales", 1),
        ("votes-10", "10 голосов", "Отдай 10 голосов в «Помоги языку»", "scales", 10),
        ("first-place", "Место пройдено", "Пройди все уроки одного места", "map-pin", 1),
        ("all-places", "Вся тропа", "Пройди все места", "flag-banner", 6),
    ]

    /// Награда набора: `earnedOn` — получена (прогресс равен цели), иначе прогресс `progress` из цели.
    static func award(_ id: String, earnedOn: String? = nil, progress: Int = 0) -> S.Achievement {
        let a = awardSet.first { $0.id == id }!
        return .init(id: a.id, titleRu: a.title, descriptionRu: a.text, icon: a.icon, earnedOn: earnedOn, progress: earnedOn != nil ? a.target : progress, target: a.target)
    }

    /// Награды демо-ученика (как demoAchievements веба): 5 из 12 — серия 5 дней, 7 слов, первое место ещё не пройдено.
    static let achievements: S.MyAchievements = {
        let earned = ["first-lesson": "2026-11-03", "perfect-lesson": "2026-11-04", "streak-3": "2026-11-05", "first-vote": "2026-11-05", "votes-10": "2026-11-07"]
        let progress = ["streak-7": 5, "streak-30": 5, "goal-7": 4, "words-10": 7, "words-50": 7]
        let list = awardSet.map { award($0.id, earnedOn: earned[$0.id], progress: progress[$0.id] ?? 0) }
        return .init(earned: list.filter { $0.earnedOn != nil }.count, total: list.count, achievements: list)
    }()

    /// Итог урока, который принёс награду «7 дней подряд».
    static let summaryWithAward: S.LessonRunSummary = {
        var s = summary
        s.newAchievements = [award("streak-7", earnedOn: "2026-11-05")]
        return s
    }()
}
