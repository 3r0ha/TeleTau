@testable import DesignSystem
import Foundation
import Testing
@testable import TeleTauAPI
@testable import TeleTauFeatures

// Автомат урока (порт machine.ts веба): повтор ошибок в конце урока, предел повторов, прогресс, поток после урока.

@Suite("Автомат урока")
struct LessonMachineTests {
    typealias M = LessonMachine

    func started() -> FlowState {
        let s = M.reduce(.trail(sealed: nil), .start(NodeRef(id: Fixture.run.lessonId, kind: .lesson), runId: Fixture.run.runId))
        return M.reduce(s, .runReady(Fixture.run, now: Fixture.started))
    }

    func answer(_ s: FlowState, _ result: S.AttemptResult) -> FlowState {
        M.reduce(M.reduce(s, .check(attemptId: result.attemptId)), .verdict(result))
    }

    func result(_ id: String, _ verdict: S.Verdict, retry: Bool = false) -> S.AttemptResult {
        .init(attemptId: "a-\(id)", exerciseId: id, verdict: verdict, firstAttempt: true, retry: retry)
    }

    @Test("Старт и пустой забег: без упражнений — «Здесь пока пусто»")
    func startAndEmpty() {
        guard case .lesson(let l) = started() else { Issue.record("ожидался урок"); return }
        #expect(l.queue == ["e01", "e02", "e03", "e04", "e05"])
        var empty = Fixture.run
        empty.exercises = []
        let s = M.reduce(M.reduce(.trail(sealed: nil), .start(.review, runId: "r")), .runReady(empty, now: Fixture.started))
        #expect(s == .empty(.review))
        #expect(M.reduce(s, .continue) == .trail(sealed: nil))
    }

    @Test("Неверный ответ с retry возвращается в конец урока, показ помечен повтором")
    func wrongGoesToEnd() {
        var s = answer(started(), result("e01", .wrong, retry: true))
        guard case .lesson(let l1) = s else { return }
        #expect(l1.willRetry)
        #expect(l1.progress == 0, "неверный ответ не двигает прогресс")
        s = M.reduce(s, .next)
        guard case .lesson(let l2) = s else { return }
        #expect(l2.queue == ["e02", "e03", "e04", "e05", "e01"])
        #expect(l2.retries["e01"] == 1)
        #expect(!l2.isRetry)
    }

    @Test("Повторов не больше трёх: дальше упражнение закрывается")
    func retryLimit() {
        var run = Fixture.run
        run.exercises = [Fixture.tiles]
        var s = M.reduce(M.reduce(.trail(sealed: nil), .start(NodeRef(id: "x", kind: .lesson), runId: "r")), .runReady(run, now: Fixture.started))
        for i in 0..<LessonMachine.maxRetries {
            s = M.reduce(answer(s, result("e01", .wrong, retry: true)), .next)
            guard case .lesson(let l) = s else { Issue.record("урок закончился на повторе \(i)"); return }
            #expect(l.isRetry)
        }
        s = M.reduce(answer(s, result("e01", .wrong, retry: true)), .next)
        guard case .completing(let l, false) = s else { Issue.record("ожидалось завершение"); return }
        #expect(l.finished == ["e01"])
    }

    @Test("«Почти» засчитывается: прогресс растёт, повтора нет")
    func almostCounts() {
        let s = answer(started(), result("e01", .almost))
        guard case .lesson(let l) = s else { return }
        #expect(l.progress == 0.2)
        #expect(!l.willRetry)
    }

    @Test("Повторная проверка во время запроса не уходит; сбой сети сохраняет attemptId")
    func checkingGuard() {
        var s = M.reduce(started(), .check(attemptId: "A"))
        s = M.reduce(s, .check(attemptId: "B"))
        guard case .lesson(let l) = s else { return }
        #expect(l.attemptId == "A")
        s = M.reduce(s, .attemptFailed)
        s = M.reduce(s, .check(attemptId: "C"))
        guard case .lesson(let l2) = s else { return }
        #expect(l2.attemptId == "A", "повтор после сбоя — с тем же attemptId")
    }

    @Test("После урока: итог → серия → новая лига → тропа с запечатанным узлом")
    func afterFlow() {
        guard case .lesson(var l) = started() else { return }
        l.queue = []
        let completing = FlowState.completing(l, failed: false)
        let failed = M.reduce(completing, .completeFailed)
        #expect(failed == .completing(l, failed: true))
        #expect(M.reduce(failed, .retryComplete) == completing)
        var s = M.reduce(completing, .completed(Fixture.summary, showStreak: true))
        guard case .result = s else { Issue.record("ожидался итог"); return }
        s = M.reduce(s, .continue)
        guard case .streak = s else { Issue.record("ожидалась серия"); return }
        s = M.reduce(s, .continue)
        guard case .leagueUp = s else { Issue.record("ожидалась новая лига"); return }
        #expect(M.reduce(s, .continue) == .trail(sealed: "u01-moya-shkola"))
    }

    @Test("Новые награды: итог → серия → «Новая награда!» → новая лига → тропа")
    func afterFlowWithAward() {
        let after = AfterLesson(node: NodeRef(id: Fixture.run.lessonId, kind: .lesson), run: Fixture.run, summary: Fixture.summaryWithAward, showStreak: true)
        var s = M.reduce(.result(after), .continue)
        #expect(s == .streak(after))
        s = M.reduce(s, .continue)
        #expect(s == .achievement(after))
        s = M.reduce(s, .continue)
        #expect(s == .leagueUp(after))
        #expect(M.reduce(s, .continue) == .trail(sealed: "u01-moya-shkola"))
    }

    @Test("Награда без серии и лиги: итог → «Новая награда!» → тропа; пустой список — экрана нет")
    func awardOnly() {
        var summary = Fixture.summaryWithAward
        summary.leagueResult = nil
        let after = AfterLesson(node: NodeRef(id: Fixture.run.lessonId, kind: .lesson), run: Fixture.run, summary: summary, showStreak: false)
        #expect(M.reduce(.result(after), .continue) == .achievement(after))
        #expect(M.reduce(.achievement(after), .continue) == .trail(sealed: "u01-moya-shkola"))

        summary.newAchievements = []
        let none = AfterLesson(node: NodeRef(id: Fixture.run.lessonId, kind: .lesson), run: Fixture.run, summary: summary, showStreak: true)
        #expect(M.reduce(.result(none), .continue) == .streak(none))
        #expect(M.reduce(.streak(none), .continue) == .trail(sealed: "u01-moya-shkola"))
    }

    @Test("Награда за испытание для перехода: после итога испытания — «Новая награда!», узел не «запечатывается»")
    func awardAfterJump() {
        var summary = Fixture.jumpSummary(passed: true)
        summary.newAchievements = [Fixture.award("first-place", earnedOn: "2026-11-05")]
        let after = AfterLesson(node: .jump(Fixture.courseJump.units[1]), run: Fixture.jumpRun, summary: summary, showStreak: false)
        #expect(M.reduce(.result(after), .continue) == .achievement(after))
        #expect(M.reduce(.achievement(after), .continue) == .trail(sealed: nil))
    }

    @Test("«Дальше» действует только на экранах после урока; урок и тропа его не принимают")
    func continueOnlyAfter() {
        #expect(M.reduce(.trail(sealed: nil), .continue) == .trail(sealed: nil))
        let lesson = started()
        #expect(M.reduce(lesson, .continue) == lesson)
    }

    @Test("Повторение слов не «запечатывает» узел тропы")
    func reviewNotSealed() {
        var summary = Fixture.summary
        summary.leagueResult = nil
        let after = AfterLesson(node: .review, run: Fixture.run, summary: summary, showStreak: false)
        #expect(M.reduce(.result(after), .continue) == .trail(sealed: nil))
    }

    @Test("Выход из урока — на тропу; «Остаться» снимает вопрос")
    func quitStay() {
        var s = M.reduce(started(), .quit)
        guard case .lesson(let l) = s else { return }
        #expect(l.quit)
        s = M.reduce(s, .stay)
        guard case .lesson(let l2) = s else { return }
        #expect(!l2.quit)
        #expect(M.reduce(s, .leave) == .trail(sealed: nil))
    }

    @Test("Черновик ответа: «Пары» — только все пары, текст — без пустого ввода")
    func drafts() {
        #expect(AnswerDraft.pairs([.init(left: "l1", right: "r1")], needed: 2).answer == nil)
        #expect(AnswerDraft.pairs([.init(left: "l1", right: "r1"), .init(left: "l2", right: "r2")], needed: 2).answer != nil)
        #expect(AnswerDraft.text("  \n").answer == nil)
        #expect(AnswerDraft.tiles([]).answer == nil)
    }

    @Test("Тексты: множественное число, время, дни недели, ошибки на «ты»")
    func formatting() {
        #expect(Format.plural(1, ("день", "дня", "дней")) == "день")
        #expect(Format.plural(3, ("день", "дня", "дней")) == "дня")
        #expect(Format.plural(11, ("день", "дня", "дней")) == "дней")
        #expect(Format.plural(22, ("день", "дня", "дней")) == "дня")
        #expect(Format.duration(161) == "2:41")
        #expect(Format.weekdayShort("2026-11-05") == "Чт")
        #expect(Format.seat(7) == "№07")
        #expect(ChildText.describe(.problem(.init(status: 404, code: "class_code_not_found"))) == "Код не подходит. Проверь буквы или попроси новый код.")
        #expect(ChildText.describe(.problem(.init(status: 418))) == "Что-то сломалось. Попробуй ещё раз.")
        #expect(ChildText.describe(.offline) == "Нет связи. Проверь интернет.")
        #expect(AssignmentText.due("2026-11-05", today: "2026-11-05") == "сегодня последний день")
        #expect(AssignmentText.due("2026-11-06", today: "2026-11-05") == "до завтра")
        #expect(AssignmentText.due("2026-11-07", today: "2026-11-05") == "до сб")
        #expect(AssignmentText.due("2026-11-20", today: "2026-11-05") == "до 20 ноября")
        #expect(AssignmentText.ufaDay(Date(timeIntervalSince1970: 1_793_818_800)) == "2026-11-05", "19:00 UTC — уже 5 ноября по Уфе (UTC+5)")
    }
}

@Suite("«Послушать»: адрес записи")
struct ClipAddressTests {
    let web = URL(string: "http://192.168.1.5:3000")

    @Test("Относительный путь — от адреса сайта, абсолютный — как есть")
    func resolves() {
        #expect(ClipAddress.resolve("/audio/063d0f07d15ef02e.m4a", webBase: web)?.absoluteString == "http://192.168.1.5:3000/audio/063d0f07d15ef02e.m4a")
        #expect(ClipAddress.resolve("/audio/a.m4a", webBase: URL(string: "https://teletau.study/app/"))?.absoluteString == "https://teletau.study/app/audio/a.m4a")
        #expect(ClipAddress.resolve("https://teletau.study/audio/a.mp3", webBase: web)?.absoluteString == "https://teletau.study/audio/a.mp3")
        #expect(ClipAddress.resolve("https://upload.wikimedia.org/wikipedia/commons/0/00/LL-Q13389_(bak)-Example.wav", webBase: web) != nil)
    }

    @Test("Ogg, WebM и чужие схемы iOS не играет — кнопки нет")
    func unsupported() {
        #expect(ClipAddress.resolve("https://upload.wikimedia.org/wikipedia/commons/0/02/Ba-x.ogg", webBase: web) == nil)
        #expect(ClipAddress.resolve("/audio/x.oga", webBase: web) == nil)
        #expect(ClipAddress.resolve("/audio/x.opus", webBase: web) == nil)
        #expect(ClipAddress.resolve("/audio/x.webm", webBase: web) == nil)
        #expect(ClipAddress.resolve("file:///etc/x.m4a", webBase: web) == nil)
        #expect(ClipAddress.resolve("/audio/x.m4a", webBase: nil) == nil)
        #expect(ClipAddress.resolve("", webBase: web) == nil)
    }
}

@Suite("Подсказки и итог ответа")
struct LessonHintTests {
    @Test("Закрытый узел: «Сначала пройди «…»» — если перед ним открытый урок, иначе «предыдущие уроки»")
    func lockedHint() {
        #expect(TeleTauFeatures.lockedHint(Fixture.course, nodeId: "u01-vezhlivye-slova") == "Сначала пройди «Моя школа»")
        #expect(TeleTauFeatures.lockedHint(Fixture.course, nodeId: "u01-help-2") == "Сначала пройди предыдущие уроки")
        #expect(TeleTauFeatures.lockedHint(Fixture.course, nodeId: "u02-1") == "Сначала пройди предыдущие уроки")
    }

    @Test("«Почти!»: в верном слове выделена буква из подсказки (номер слова и буквы)")
    func hintedAnswer() {
        let runs = HintedAnswer.runs("дәфтәр", hint: .init(expected: "ә", got: "а", token: 0, index: 1))
        #expect(runs.map(\.text) == ["д", "ә", "фтәр"])
        #expect(runs.map(\.marked) == [false, true, false])
        #expect(runs.allSatisfy { $0.kind == .bashkir })
        // Второе слово, буквы без знаков препинания: «Рәхмәт, дуҫ!» — «ҫ» в «дуҫ».
        let second = HintedAnswer.runs("Рәхмәт, дуҫ!", hint: .init(expected: "ҫ", got: "с", token: 1, index: 2))
        #expect(second.filter(\.marked).map(\.text) == ["ҫ"])
        #expect(second.map(\.text).joined() == "Рәхмәт, дуҫ!")
        // Без подсказки — слово целиком.
        #expect(HintedAnswer.runs("китап", hint: nil).count == 1)
    }

    @Test("Цвет ответа после проверки: верно — зелень, не так — коралл, голос — без цвета")
    func verdictTone() {
        #expect(answerVerdict(Fixture.almost) == .almost)
        #expect(answerVerdict(Fixture.wrongChoice) == .bad)
        #expect(answerVerdict(Fixture.voted) == nil)
        #expect(answerVerdict(nil) == nil)
    }
}

@MainActor
@Suite("Знакомство с пчелой")
struct TrailIntroTests {
    @Test("Показывается, пока не пройден ни один урок; после «Пропустить» — больше никогда для этого ученика")
    func shownOnce() async throws {
        let defaults = try #require(UserDefaults(suiteName: "teletau.tests.intro.\(UUID().uuidString)"))
        let model = StudentModel(backend: StubBackend(progress: Fixture.progressNew), me: Fixture.me, defaults: defaults)
        await model.loadTrail()
        #expect(model.showIntro)
        #expect(model.introGoal == 2)
        model.closeIntro(start: false)
        #expect(!model.showIntro)
        let again = StudentModel(backend: StubBackend(progress: Fixture.progressNew), me: Fixture.me, defaults: defaults)
        await again.loadTrail()
        #expect(!again.showIntro)
    }

    @Test("Ученику с пройденными уроками знакомство не показывается")
    func notForReturning() async throws {
        let defaults = try #require(UserDefaults(suiteName: "teletau.tests.intro.\(UUID().uuidString)"))
        let model = StudentModel(backend: StubBackend(progress: Fixture.progress), me: Fixture.me, defaults: defaults)
        await model.loadTrail()
        #expect(!model.showIntro)
    }
}

@MainActor
@Suite("Звуки интерфейса")
struct UISoundTests {
    @Test("Ноты синтезируются в буфер без файлов: длина по последней ноте, без перегруза")
    func renders() throws {
        for name in [UISound.Name.tap, .correct, .almost, .wrong, .voted, .complete, .streak, .levelUp] {
            let notes = UISound.notes(name)
            let buffer = try #require(UISound.shared.render(notes))
            let expected = (notes.map { $0.at + $0.dur }.max() ?? 0) + 0.05
            #expect(abs(Double(buffer.frameLength) / 44_100 - expected) < 0.01)
            let samples = UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength))
            let peak = samples.map { abs($0) }.max() ?? 0
            #expect(peak > 0.01 && peak <= 0.9, "\(name): пик \(peak)")
        }
    }
}

@Suite("«Новое слово» и подсказки к словам")
struct WordIntroTests {
    typealias M = LessonMachine

    @Test("Карточка «Новое слово»: «Дальше» без ответа, проверка не начинается, в прогрессе — шаг")
    func introSkipsAttempt() {
        var s = M.reduce(M.reduce(.trail(sealed: nil), .start(NodeRef(id: Fixture.introRun.lessonId, kind: .lesson), runId: Fixture.introRun.runId)),
                         .runReady(Fixture.introRun, now: Fixture.started))
        guard case .lesson(let l0) = s else { Issue.record("ожидался урок"); return }
        #expect(l0.isIntro)
        #expect(M.reduce(s, .check(attemptId: "a")) == s, "у карточки нет ответа — запрос не уходит")
        s = M.reduce(s, .next)
        guard case .lesson(let l1) = s else { Issue.record("ожидался урок"); return }
        #expect(l1.finished == ["w01"])
        #expect(l1.isIntro)
        #expect(abs(l1.progress - 0.2) < 0.001)
        s = M.reduce(s, .next)
        guard case .lesson(let l2) = s else { Issue.record("ожидался урок"); return }
        #expect(!l2.isIntro)
        #expect(l2.current?.exerciseId == "e11")
        #expect(M.reduce(s, .next) == s, "у упражнения «Дальше» — только после вердикта")
    }

    @Test("Подсказки: по порядку, каждая — с конца предыдущей; знак препинания приклеен к слову")
    func splitsPrompt() {
        let hint = { (t: String) in PromptHint(text: t, translation: Fixture.ba("x")) }
        let chunks = PromptChunks.split("Это школа, и это школа.", hints: [hint("школа"), hint("школа")])
        #expect(chunks.map(\.text) == ["Это", "школа", ",", "и", "это", "школа", "."])
        #expect(chunks.map(\.hint) == [nil, 0, nil, nil, nil, 1, nil])
        #expect(chunks.map(\.spaceBefore) == [false, true, false, true, true, true, false])
        // Ненайденная подсказка пропускается, следующая ищется с прежнего места.
        let skipped = PromptChunks.split("Средняя школа", hints: [hint("книга"), hint("школа")])
        #expect(skipped.map(\.hint) == [nil, 1])
        // Фраза целиком — один кусок.
        #expect(PromptChunks.split("Доброе утро!", hints: [hint("Доброе утро")]).map(\.text) == ["Доброе утро", "!"])
    }
}

@MainActor
@Suite("Подсказки в ответе")
struct HintsUsedTests {
    /// Ждёт, пока задачи модели (запросы к заглушке) не приведут поток в нужное состояние.
    func wait(_ what: String, _ model: StudentModel, until done: (FlowState) -> Bool) async throws {
        for _ in 0..<400 {
            if done(model.flow) { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        Issue.record("не дождались: \(what)")
    }

    func verdict(_ s: FlowState) -> Bool {
        if case .lesson(let l) = s { l.feedback != nil } else { false }
    }

    @Test("Открыл подсказку — в ответе hintsUsed (разные подсказки этого показа); не открывал — поля нет")
    func sendsHintsUsed() async throws {
        let defaults = try #require(UserDefaults(suiteName: "teletau.tests.hints.\(UUID().uuidString)"))
        var backend = StubBackend(progress: Fixture.progress)
        var run = Fixture.introRun
        run.exercises = [Fixture.tilesHinted, Fixture.freeHinted]
        backend.review = run
        let model = StudentModel(backend: backend, me: Fixture.me, defaults: defaults)
        model.startReview()
        try await wait("урок", model) { if case .lesson = $0 { true } else { false } }

        // Плитки: открыты обе подсказки, одна — дважды.
        model.hintOpened(0)
        model.hintOpened(1)
        model.hintOpened(0)
        model.check(.tiles(.init(_type: .tiles, tileIds: ["t3", "t1"])))
        try await wait("вердикт", model, until: verdict)
        // После проверки подсказка уже не считается.
        model.hintOpened(0)
        model.next()

        // Ввод: подсказку не открывали.
        model.check(.text(.init(_type: .text, text: "дәфтәр")))
        try await wait("вердикт", model, until: verdict)

        let sent = backend.attempts.all
        try #require(sent.count == 2)
        #expect(sent[0].exerciseId == "e11")
        #expect(sent[0].hintsUsed == 2)
        #expect(sent[1].exerciseId == "e13")
        #expect(sent[1].hintsUsed == nil)
        let json = String(decoding: try JSONEncoder().encode(sent[1]), as: UTF8.self)
        #expect(!json.contains("hintsUsed"), "без подсказок поля в запросе нет: \(json)")
        #expect(String(decoding: try JSONEncoder().encode(sent[0]), as: UTF8.self).contains("\"hintsUsed\":2"))
    }
}

@Suite("Испытание для перехода к месту")
struct JumpMachineTests {
    typealias M = LessonMachine

    var unit: S.CourseUnit { Fixture.courseJump.units[1] }

    func started() -> FlowState {
        M.reduce(M.reduce(.trail(sealed: nil), .start(.jump(unit), runId: Fixture.jumpRun.runId)), .runReady(Fixture.jumpRun, now: Fixture.started))
    }

    func answer(_ s: FlowState, _ id: String, _ verdict: S.Verdict, runEnded: Bool? = nil) -> FlowState {
        let result = S.AttemptResult(attemptId: "a-\(id)", exerciseId: id, verdict: verdict, firstAttempt: true, retry: false, runEnded: runEnded)
        return M.reduce(M.reduce(s, .check(attemptId: result.attemptId)), .verdict(result))
    }

    @Test("Испытание начинается по месту: id — место, вид jump")
    func startsByUnit() {
        #expect(NodeRef.jump(unit) == NodeRef(id: "02-shulgantash", kind: .jump))
        guard case .lesson(let l) = started() else { Issue.record("ожидалось испытание"); return }
        #expect(l.node.kind == .jump)
        #expect(l.queue == ["e01", "e02", "e03"])
    }

    @Test("Ошибка без runEnded — дальше по порядку, без повтора в конце")
    func mistakeGoesOn() {
        let s = M.reduce(answer(started(), "e01", .wrong), .next)
        guard case .lesson(let l) = s else { Issue.record("ожидалось испытание"); return }
        #expect(l.queue == ["e02", "e03"])
        #expect(l.retries.isEmpty)
    }

    @Test("runEnded: лист с ответом, по «Дальше» — сразу завершение, оставшиеся упражнения не показываются")
    func runEndedCompletes() {
        var s = answer(started(), "e01", .wrong)
        s = M.reduce(s, .next)
        s = answer(s, "e02", .wrong, runEnded: true)
        guard case .lesson(let l) = s else { Issue.record("лист с ответом должен остаться"); return }
        #expect(l.feedback?.runEnded == true)
        #expect(l.queue == ["e02", "e03"])
        s = M.reduce(s, .next)
        guard case .completing(let done, false) = s else { Issue.record("ожидалось завершение, а не e03"); return }
        #expect(done.queue.isEmpty)
        #expect(!done.finished.contains("e03"))
    }

    @Test("runEnded в обычном уроке тоже завершает забег, даже когда ошибка должна была вернуться в конец")
    func runEndedBeatsRetry() {
        var s = M.reduce(M.reduce(.trail(sealed: nil), .start(NodeRef(id: Fixture.run.lessonId, kind: .lesson), runId: Fixture.run.runId)),
                         .runReady(Fixture.run, now: Fixture.started))
        let result = S.AttemptResult(attemptId: "a", exerciseId: "e01", verdict: .wrong, firstAttempt: true, retry: true, runEnded: true)
        s = M.reduce(M.reduce(s, .check(attemptId: "a")), .verdict(result))
        guard case .completing = M.reduce(s, .next) else { Issue.record("ожидалось завершение"); return }
    }

    @Test("Испытание не «запечатывает» узел: итог → серия → тропа без печати")
    func notSealed() {
        guard case .lesson(var l) = started() else { return }
        l.queue = []
        var s = M.reduce(.completing(l, failed: false), .completed(Fixture.jumpSummary(passed: true), showStreak: true))
        guard case .result(let after) = s else { Issue.record("ожидался итог"); return }
        #expect(after.node.sealable == nil)
        s = M.reduce(s, .continue)
        guard case .streak = s else { Issue.record("ожидалась серия"); return }
        #expect(M.reduce(s, .continue) == .trail(sealed: nil))
        let failed = AfterLesson(node: .jump(unit), run: Fixture.jumpRun, summary: Fixture.jumpSummary(passed: false), showStreak: false)
        #expect(M.reduce(.result(failed), .continue) == .trail(sealed: nil))
    }
}

@MainActor
@Suite("Испытание для перехода: модель и тропа")
struct JumpModelTests {
    func wait(_ what: String, _ model: StudentModel, until done: (FlowState) -> Bool) async throws {
        for _ in 0..<400 {
            if done(model.flow) { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        Issue.record("не дождались: \(what)")
    }

    @Test("«Пройти испытание» начинает забег jump по месту (не урок); место без jump — ничего не происходит")
    func startsJumpRun() async throws {
        let defaults = try #require(UserDefaults(suiteName: "teletau.tests.jump.\(UUID().uuidString)"))
        var backend = StubBackend(progress: Fixture.progress)
        backend.courseValue = Fixture.courseJump
        backend.jump = Fixture.jumpRun
        let model = StudentModel(backend: backend, me: Fixture.me, defaults: defaults)
        await model.loadTrail()
        model.startJump(Fixture.courseJump.units[0])
        #expect(model.flow == .trail(sealed: nil), "у Уфы нет jump")
        model.startJump(Fixture.courseJump.units[1])
        #expect(model.busyNode == "02-shulgantash", "кнопка у вывески — в загрузке")
        try await wait("испытание", model) { if case .lesson(let l) = $0 { l.node.kind == .jump } else { false } }
    }

    @Test("Урок, засчитанный испытанием, — «пройден испытанием» в доступности")
    func passedByTestLabel() {
        let nodes = Fixture.courseJumped.units[0].nodes
        let byTest = NodeCell(node: nodes[4], index: 4, sealed: false, disabled: false, onStart: { _ in })
        #expect(byTest.label == "Урок «Вежливые слова», пройден испытанием")
        #expect(byTest.state == .done)
        let passed = NodeCell(node: nodes[0], index: 0, sealed: false, disabled: false, onStart: { _ in })
        #expect(passed.label == "Урок «Привет!», пройден")
        let test = NodeCell(node: nodes[6], index: 6, sealed: false, disabled: false, onStart: { _ in })
        #expect(test.label == "Испытание места, пройден испытанием")
    }
}
