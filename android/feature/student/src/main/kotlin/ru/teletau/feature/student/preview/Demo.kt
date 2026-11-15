package ru.teletau.feature.student.preview

import ru.teletau.core.network.models.AccountKind
import ru.teletau.core.network.models.AttemptResult
import ru.teletau.core.network.models.BaString
import ru.teletau.core.network.models.CellsSummary
import ru.teletau.core.network.models.ChoiceExercise
import ru.teletau.core.network.models.ChoiceExerciseType
import ru.teletau.core.network.models.ChoiceOption
import ru.teletau.core.network.models.ClassHive
import ru.teletau.core.network.models.ClassParticipation
import ru.teletau.core.network.models.ClassQuest
import ru.teletau.core.network.models.Course
import ru.teletau.core.network.models.CourseUnit
import ru.teletau.core.network.models.DuelExercise
import ru.teletau.core.network.models.DuelExerciseType
import ru.teletau.core.network.models.FreeInputExercise
import ru.teletau.core.network.models.FreeInputExerciseType
import ru.teletau.core.network.models.HiveDay
import ru.teletau.core.network.models.HoneyBreakdown
import ru.teletau.core.network.models.HoneyTotals
import ru.teletau.core.network.models.LeagueBadge
import ru.teletau.core.network.models.LeagueMember
import ru.teletau.core.network.models.LeagueOutcome
import ru.teletau.core.network.models.LeagueResult
import ru.teletau.core.network.models.LeagueStanding
import ru.teletau.core.network.models.LeagueTier
import ru.teletau.core.network.models.LeagueZone
import ru.teletau.core.network.models.LeagueZones
import ru.teletau.core.network.models.LessonRun
import ru.teletau.core.network.models.LessonRunSummary
import ru.teletau.core.network.models.LetterHint
import ru.teletau.core.network.models.Locale
import ru.teletau.core.network.models.Me
import ru.teletau.core.network.models.MembershipRole
import ru.teletau.core.network.models.MyCellsPage
import ru.teletau.core.network.models.MyClass
import ru.teletau.core.network.models.MyProgress
import ru.teletau.core.network.models.NodeIcon
import ru.teletau.core.network.models.NodeKind
import ru.teletau.core.network.models.NodeState
import ru.teletau.core.network.models.Place
import ru.teletau.core.network.models.PublicLeaderboard
import ru.teletau.core.network.models.PublicLeaderboardClass
import ru.teletau.core.network.models.PublicLeaderboardPeriod
import ru.teletau.core.network.models.PublicLeaderboardSchool
import ru.teletau.core.network.models.ReviewStatus
import ru.teletau.core.network.models.Role
import ru.teletau.core.network.models.RunExercise
import ru.teletau.core.network.models.RunKind
import ru.teletau.core.network.models.RunStatus
import ru.teletau.core.network.models.StreakDay
import ru.teletau.core.network.models.StreakDayStatus
import ru.teletau.core.network.models.StreakState
import ru.teletau.core.network.models.TeacherStatus
import ru.teletau.core.network.models.Tile
import ru.teletau.core.network.models.TilesExercise
import ru.teletau.core.network.models.TilesExerciseType
import ru.teletau.core.network.models.TrailNode
import ru.teletau.core.network.models.UiMode
import ru.teletau.core.network.models.UnitState
import ru.teletau.core.network.models.Verdict
import ru.teletau.core.network.models.VoteTotals
import ru.teletau.core.network.models.Week

/**
 * Данные для превью и снимков экранов — как демо-мир показа (docs/demo/M2.md): «Смелая пчела», 5 «Б», урок «Моя школа».
 * Башкирские строки — копии из content/course и content/corpus (там же флаг needs_native_review); в приложении
 * башкирский текст приходит только из API.
 */
internal object Demo {
    private val review = ReviewStatus.needsNativeReview
    private fun ba(text: String, audio: String? = null) = BaString(text = text, review = review, audio = audio?.let { ru.teletau.core.network.models.AudioClip(origin = ru.teletau.core.network.models.AudioOrigin.native, url = it) })

    /** Запись носителя — относительный адрес на сайте (как будут отдавать записи после переноса с Commons). */
    const val AUDIO = "/audio/da06a402759ce347.m4a"

    val me = Me(
        id = "7d3f0c7e-1111-4a8b-9c2d-000000000007",
        kind = AccountKind.child,
        roles = listOf(Role.student),
        locale = Locale.ru,
        teacherStatus = TeacherStatus.none,
        classes = listOf(MyClass(id = "5b000000-0000-4000-8000-000000000005", title = "5 «Б»", schoolName = "Демо-школа № 1", role = MembershipRole.student, seatNumber = 7)),
        pendingConsents = emptyList(),
        nickname = "Смелая пчела",
        uiMode = UiMode.bortnik,
    )

    /** «Учусь сам» (ADR 0022): без класса, с личной карточкой. */
    val selfMe = me.copy(
        nickname = "Мудрая сова", classes = emptyList(), ageBand = ru.teletau.core.network.models.AgeBand.age1114, dailyGoal = 2,
        loginCard = ru.teletau.core.network.models.LoginCardStatus.issued,
    )

    val loginCard = ru.teletau.core.network.models.LoginCard(payload = "TP1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.4S", version = 1, issuedAt = "2026-11-05T08:00:00Z")

    private fun node(id: String, title: String, state: NodeState, kind: NodeKind = NodeKind.lesson, icon: NodeIcon? = null) =
        TrailNode(id = id, kind = kind, state = state, titleRu = title, icon = icon, exerciseCount = 8, completions = if (state == NodeState.done) 1 else 0)

    /**
     * Все 6 мест курса (названия и темы — из content/course/ba-ru): проверка вёрстки вывесок и подписей на узких экранах
     * и крупном шрифте. Пройдены первые четыре, сейчас — «Башкирская деревня» (самое длинное название).
     */
    val courseAll: Course by lazy {
        fun unit(id: String, order: Int, slug: String, ru: String, baTitle: String?, topic: String, state: UnitState, titles: List<String>, current: Int) = CourseUnit(
            id = id, order = order, state = state, topicRu = topic,
            place = Place(slug = slug, titleRu = ru, titleBa = baTitle?.let { ba(it) }),
            nodes = titles.mapIndexed { i, t ->
                val st = when {
                    current < 0 || i < current -> if (state == UnitState.locked) NodeState.locked else NodeState.done
                    i == current -> NodeState.current
                    else -> NodeState.locked
                }
                node("$id-$i", t, st, if (t == "Помоги языку") NodeKind.helpLanguage else if (t == "Испытание места") NodeKind.placeTest else NodeKind.lesson)
            },
        )
        Course(
            id = "ba-ru", contentVersion = 2,
            units = listOf(
                unit("01-ufa", 1, "ufa", "Уфа", "Өфө", "Знакомство", UnitState.open, listOf("Привет!", "Как вас зовут?", "Испытание места"), -1),
                unit("02-shulgantash", 2, "shulgantash", "Шульган-Таш", "Шүлгәнташ", "Семья", UnitState.open, listOf("Мама и папа", "Братья и сёстры", "Испытание места"), -1),
                unit("03-agidel", 3, "agidel", "Агидель", "Ағиҙел", "Природа", UnitState.open, listOf("Река", "Испытание места"), -1),
                unit("04-yamantau", 4, "yamantau", "Гора Ямантау", "Ямантау", "Числа и время", UnitState.open, listOf("Считаем до десяти", "Который час?", "Вчера, сегодня, завтра", "Испытание места"), -1),
                unit("05-village", 5, "village", "Башкирская деревня", null, "Еда", UnitState.open, listOf("Завтрак", "Мёд и чай", "Помоги языку", "На кухне", "В магазине", "Испытание места"), 1),
                unit("06-sabantuy", 6, "sabantuy", "Сабантуй", "Һабантуй", "Праздники и игры", UnitState.locked, listOf("Игры", "Курэш и скачки", "Поздравления"), -1),
            ),
        )
    }

    val course = Course(
        id = "ba-ru",
        contentVersion = 2,
        review = ru.teletau.core.network.models.ReviewDue(due = 4),
        units = listOf(
            CourseUnit(
                id = "01-ufa", order = 1, state = UnitState.open, topicRu = "Знакомство",
                place = Place(slug = "ufa", titleRu = "Уфа", titleBa = ba("Өфө")),
                nodes = listOf(
                    node("u01-privet", "Привет!", NodeState.done, icon = NodeIcon.star),
                    node("u01-kak-tebya-zovut", "Как вас зовут?", NodeState.done, icon = NodeIcon.chatCircleText),
                    node("u01-help-1", "Помоги языку", NodeState.done, NodeKind.helpLanguage),
                    node("u01-moya-shkola", "Моя школа", NodeState.current, icon = NodeIcon.bookOpen),
                    node("u01-vezhlivye-slova", "Вежливые слова", NodeState.locked, icon = NodeIcon.star),
                    node("u01-help-2", "Помоги языку", NodeState.locked, NodeKind.helpLanguage),
                    node("u01-ispytanie", "Испытание места", NodeState.locked, NodeKind.placeTest),
                ),
            ),
            CourseUnit(
                id = "02-shulgantash", order = 2, state = UnitState.locked, topicRu = "Семья",
                place = Place(slug = "shulgantash", titleRu = "Шульган-Таш", titleBa = ba("Шүлгәнташ")),
                nodes = listOf(
                    node("u02-mama-i-papa", "Мама и папа", NodeState.locked, icon = NodeIcon.star),
                    node("u02-bratya", "Братья и сёстры", NodeState.locked, icon = NodeIcon.chatCircleText),
                    node("u02-help-1", "Помоги языку", NodeState.locked, NodeKind.helpLanguage),
                    node("u02-moy-dom", "Мой дом", NodeState.locked, icon = NodeIcon.bookOpen),
                ),
            ),
            CourseUnit(
                id = "03-agidel", order = 3, state = UnitState.locked, topicRu = "Природа",
                place = Place(slug = "agidel", titleRu = "Агидель", titleBa = ba("Ағиҙел")),
                nodes = listOf(
                    node("u03-reka", "Река", NodeState.locked, icon = NodeIcon.star),
                    node("u03-les", "Лес", NodeState.locked, icon = NodeIcon.chatCircleText),
                ),
            ),
        ),
    )

    private fun week(vararg s: StreakDayStatus) = listOf("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08")
        .mapIndexed { i, d -> StreakDay(date = d, status = s[i]) }

    val streakAfter = StreakState(
        current = 6, longest = 6, freezes = 2, extendedToday = true, today = "2026-11-07",
        week = week(StreakDayStatus.done, StreakDayStatus.done, StreakDayStatus.done, StreakDayStatus.done, StreakDayStatus.done, StreakDayStatus.done, StreakDayStatus.future),
    )

    val progress = MyProgress(
        honey = HoneyTotals(total = 245, pending = 6),
        streak = streakAfter.copy(current = 5, extendedToday = false),
        lessonsCompleted = 3,
        wordsLearned = 86,
        votes = VoteTotals(total = 7, matured = 5, pending = 2),
        league = LeagueBadge(tier = LeagueTier.fireweed, points = 120, rank = 7),
        dailyGoal = ru.teletau.core.network.models.DailyGoal(target = 2, done = 1, met = false),
    )

    val tiles = TilesExercise(
        id = "e1", type = TilesExerciseType.tilesRuBa, review = review, promptRu = "Средняя школа",
        tiles = listOf(Tile("t3", "китап"), Tile("t1", "Урта"), Tile("t4", "дәрес"), Tile("t2", "мәктәп")),
        // Подсказка к слову условия — перевод из словаря курса (как присылает сервер).
        hints = listOf(ru.teletau.core.network.models.PromptHint(text = "школа", translation = ba("мәктәп"))),
    )

    /** Карточка «Новое слово» перед заданиями со словом (word_intro). */
    val wordIntro = ru.teletau.core.network.models.WordIntroExercise(
        id = "w1", type = ru.teletau.core.network.models.WordIntroExerciseType.wordIntro, review = review,
        word = ba("мәктәп", AUDIO), translationRu = "школа",
    )
    val choice = ChoiceExercise(
        id = "e2", type = ChoiceExerciseType.choiceBaRu, review = review, prompt = "мәктәп",
        promptAudio = ru.teletau.core.network.models.AudioClip(origin = ru.teletau.core.network.models.AudioOrigin.native, url = AUDIO),
        options = listOf(ChoiceOption("o1", "книга"), ChoiceOption("o2", "школа"), ChoiceOption("o3", "урок"), ChoiceOption("o4", "учитель")),
    )
    val free = FreeInputExercise(
        id = "e3", type = FreeInputExerciseType.freeRuBa, review = review, promptRu = "тетрадь",
        letters = listOf("ә", "ө", "ү", "ғ", "ҡ", "ң", "ҙ", "ҫ", "һ"),
    )
    val duel = DuelExercise(
        id = "e4", type = DuelExerciseType.duel, review = review, itemId = "0190a8c0-0000-7000-8000-0000000000aa",
        sourceRu = "Здравствуйте!", a = "Һаумыһығыҙ!", b = "Иҫәнмеһегеҙ!",
    )

    val pairs = ru.teletau.core.network.models.MatchPairsExercise(
        id = "e5", type = ru.teletau.core.network.models.MatchPairsExerciseType.matchPairs, review = review,
        left = listOf(ru.teletau.core.network.models.PairWord("l1", "китап"), ru.teletau.core.network.models.PairWord("l2", "мәктәп"), ru.teletau.core.network.models.PairWord("l3", "дәфтәр"), ru.teletau.core.network.models.PairWord("l4", "уҡытыусы")),
        right = listOf(ru.teletau.core.network.models.PairTranslation("r1", "учитель"), ru.teletau.core.network.models.PairTranslation("r2", "книга"), ru.teletau.core.network.models.PairTranslation("r3", "тетрадь"), ru.teletau.core.network.models.PairTranslation("r4", "школа")),
    )

    val run = LessonRun(
        runId = "0190a8c0-0000-7000-8000-000000000001", lessonId = "u01-moya-shkola", kind = RunKind.lesson, titleRu = "Моя школа",
        status = RunStatus.active, startedAt = "2026-11-07T06:00:00Z",
        exercises = listOf(RunExercise.TilesRuBaWrapper(tiles), RunExercise.ChoiceBaRuWrapper(choice), RunExercise.FreeRuBaWrapper(free), RunExercise.DuelWrapper(duel), RunExercise.MatchPairsWrapper(pairs)),
    )

    val almost = AttemptResult(
        attemptId = "a3", exerciseId = "e3", verdict = Verdict.almost, firstAttempt = true, retry = false,
        correctAnswer = ba("дәфтәр"), meaningRu = "тетрадь", hint = LetterHint(expected = "ә", got = "а", token = 0, index = 1),
    )
    val correct = AttemptResult(attemptId = "a1", exerciseId = "e1", verdict = Verdict.correct, firstAttempt = true, retry = false, correctAnswer = ba("Урта мәктәп", AUDIO), meaningRu = "средняя школа")
    val wrongChoice = AttemptResult(attemptId = "a2", exerciseId = "e2", verdict = Verdict.wrong, firstAttempt = true, retry = true, correctOptionId = "o2", meaningRu = "школа")
    val recorded = AttemptResult(attemptId = "a4", exerciseId = "e4", verdict = Verdict.recorded, firstAttempt = true, retry = false)

    val leagueResult = LeagueResult(weekStart = "2026-10-26", tierBefore = LeagueTier.sweetclover, tierAfter = LeagueTier.fireweed, outcome = LeagueOutcome.promoted, rank = 4, points = 318)

    val summary = LessonRunSummary(
        runId = run.runId, lessonId = run.lessonId,
        honey = HoneyBreakdown(total = 16, base = 10, firstTry = 6, multiplier = 1.0, pendingFromVotes = 3),
        accuracy = 0.857, durationSeconds = 161,
        newWords = listOf(ba("мәктәп"), ba("дәфтәр"), ba("уҡытыусы")),
        votes = 1, streak = streakAfter, leagueResult = leagueResult,
        dailyGoal = ru.teletau.core.network.models.DailyGoal(target = 2, done = 2, met = true), dailyGoalReached = true,
    )

    /** Испытание для перехода: в Уфе идут уроки, Шульган-Таш ещё закрыт, но его можно открыть испытанием (`jump`). */
    val courseJump: Course by lazy {
        course.copy(
            review = null,
            units = listOf(
                course.units[0],
                course.units[1].copy(state = UnitState.open, jump = ru.teletau.core.network.models.PlaceJump(exerciseCount = 12, mistakesAllowed = 2)),
                course.units[2],
            ),
        )
    }

    /** Забег испытания для перехода к Шульган-Ташу: lessonId — место, заголовок «Испытание». */
    val jumpRun = run.copy(runId = "0190a8c0-0000-7000-8000-000000000002", lessonId = "02-shulgantash", kind = RunKind.jump, titleRu = "Испытание")

    /** Испытание сдано: место открыто, мёд как за «Испытание места», цель дня выполнена. */
    val jumpPassed = summary.copy(
        runId = jumpRun.runId, lessonId = jumpRun.lessonId,
        honey = HoneyBreakdown(total = 21, base = 10, firstTry = 11, multiplier = 1.0, pendingFromVotes = 0),
        accuracy = 0.917, durationSeconds = 214, newWords = emptyList(), votes = 0, leagueResult = null,
        jump = ru.teletau.core.network.models.JumpResult(unitId = "02-shulgantash", passed = true, mistakes = 1, mistakesAllowed = 2),
    )

    /** Испытание не сдано: ничего не изменилось, мёда нет. */
    val jumpFailed = jumpPassed.copy(
        honey = HoneyBreakdown(total = 0, base = 0, firstTry = 0, multiplier = 1.0, pendingFromVotes = 0),
        accuracy = 0.4, durationSeconds = 95, streak = streakAfter.copy(current = 5, extendedToday = false),
        dailyGoal = ru.teletau.core.network.models.DailyGoal(target = 2, done = 1, met = false), dailyGoalReached = false,
        jump = ru.teletau.core.network.models.JumpResult(unitId = "02-shulgantash", passed = false, mistakes = 3, mistakesAllowed = 2),
    )

    private val nicks = listOf(
        "Ловкий шмель", "Тихая берёза", "Быстрый журавль", "Ясный родник", "Смелая пчела", "Звонкая синица",
        "Добрый барсук", "Мудрая сова", "Весёлый ёж", "Рыжая лиса", "Горный сокол", "Тёплое солнце",
    )
    private val points = listOf(412, 388, 351, 330, 318, 244, 201, 120, 96, 80, 54, 31)

    val league = LeagueStanding(
        week = Week("2026-11-02", "2026-11-08"),
        endsAt = "2026-11-09T00:00:00+05:00",
        tier = LeagueTier.fireweed,
        zones = LeagueZones(promote = 5, demote = 3),
        members = nicks.mapIndexed { i, n ->
            LeagueMember(
                rank = i + 1, points = points[i], me = n == "Смелая пчела", nickname = n,
                zone = when {
                    i < 5 -> LeagueZone.promote
                    i >= nicks.size - 3 -> LeagueZone.demote
                    else -> LeagueZone.stay
                },
            )
        },
    )

    /** Доска почёта (публичная): топ школ и классов недели — место, уроки, район подписью. */
    val board = PublicLeaderboard(
        asOf = "2026-11-14T06:00:00Z",
        period = PublicLeaderboardPeriod.week,
        periodStart = "2026-11-09",
        smallGroupThreshold = 5,
        schools = listOf(
            PublicLeaderboardSchool(1, "Башкирская гимназия", "г. Уфа", 214, 31, 1580),
            PublicLeaderboardSchool(2, "СОШ №1", "Ишимбайский район", 158, 26, 940),
            PublicLeaderboardSchool(3, "Лицей №3", "г. Стерлитамак", 131, 22, 760),
        ),
        classes = listOf(
            PublicLeaderboardClass(1, "Башкирская гимназия", "г. Уфа", "5 «Б»", 64, 7, 410),
            PublicLeaderboardClass(2, "СОШ №1", "Ишимбайский район", "6 «А»", 51, 8, 330),
            PublicLeaderboardClass(3, "Лицей №3", "г. Стерлитамак", "4 «В»", 47, 6, 250),
        ),
    )

    val hive = ClassHive(
        classId = me.classes.first().id,
        week = Week("2026-11-02", "2026-11-08"),
        quest = ClassQuest(titleRu = "Пройдите всем классом 60 уроков", goal = 60, progress = 41, completed = false),
        participation = ClassParticipation(active = 18, total = 24),
        days = listOf(14, 16, 12, 18, 9, 0, 0).mapIndexed { i, a -> HiveDay(date = "2026-11-0${2 + i}", active = a) },
    )

    val words = ru.teletau.core.network.models.MyWords(
        summary = ru.teletau.core.network.models.MyWordsSummary(total = 7, learned = 4, review = 3),
        words = listOf(
            Triple("Сәләм!", "Привет!", true), Triple("Рәхмәт!", "Спасибо!", false), Triple("Хәйерле көн", "Добрый день", false),
            Triple("мәктәп", "школа", true), Triple("барам", "иду", false), Triple("Мин", "я", false), Triple("китап", "книга", false),
        ).mapIndexed { i, (w, tr, audio) ->
            ru.teletau.core.network.models.MyWord(
                id = "w$i", word = ba(w, if (audio) AUDIO else null), translationRu = tr,
                status = if (i < 3) ru.teletau.core.network.models.WordStatus.review else ru.teletau.core.network.models.WordStatus.learned,
            )
        },
    )

    val assignment = ru.teletau.core.network.models.StudentAssignment(
        id = "0190a8c0-0000-7000-8000-00000000a001", kind = ru.teletau.core.network.models.AssignmentKind.lesson, titleRu = "Моя школа",
        dueOn = "2026-11-07", done = false, lessonId = "u01-moya-shkola", placeRu = "Уфа",
    )

    val cells = MyCellsPage(summary = CellsSummary(matured = 5, pending = 3, honeyFinal = 13, honeyPending = 9), items = emptyList())

    /** Награды набора — тексты как у сервера (apps/api/src/modules/learning/achievements.ts): id, название, что сделать, значок, сколько нужно. */
    private val AWARDS = listOf(
        listOf("first-lesson", "Первый урок", "Пройди первый урок", "footprints", "1"),
        listOf("perfect-lesson", "Без ошибок", "Пройди урок без ошибок", "seal-check", "1"),
        listOf("streak-3", "3 дня подряд", "Занимайся 3 дня подряд", "fire", "3"),
        listOf("streak-7", "7 дней подряд", "Занимайся 7 дней подряд", "fire", "7"),
        listOf("streak-30", "30 дней подряд", "Занимайся 30 дней подряд", "fire", "30"),
        listOf("goal-7", "7 целей дня", "Выполни цель дня 7 раз", "target", "7"),
        listOf("words-10", "10 слов", "Выучи 10 слов", "book-open", "10"),
        listOf("words-50", "50 слов", "Выучи 50 слов", "books", "50"),
        listOf("first-vote", "Первый голос", "Проголосуй в «Помоги языку»", "scales", "1"),
        listOf("votes-10", "10 голосов", "Отдай 10 голосов в «Помоги языку»", "scales", "10"),
        listOf("first-place", "Место пройдено", "Пройди все уроки одного места", "map-pin", "1"),
        listOf("all-places", "Вся тропа", "Пройди все места", "flag-banner", "6"),
    )

    /** Награда набора: [earnedOn] — получена (прогресс равен цели), иначе [progress] из цели. */
    fun award(id: String, earnedOn: String? = null, progress: Int = 0): ru.teletau.core.network.models.Achievement {
        val (_, title, description, icon, target) = AWARDS.first { it[0] == id }
        val goal = target.toInt()
        return ru.teletau.core.network.models.Achievement(
            id = id, titleRu = title, descriptionRu = description, icon = icon,
            progress = if (earnedOn != null) goal else progress, target = goal, earnedOn = earnedOn,
        )
    }

    /** Награды демо-ученика (как demoAchievements в apps/web/test/e2e/mock-learn.ts): 5 из 12, серия 5 дней, 7 слов. */
    val achievements: ru.teletau.core.network.models.MyAchievements by lazy {
        val earned = mapOf(
            "first-lesson" to "2026-11-03", "perfect-lesson" to "2026-11-04", "streak-3" to "2026-11-05",
            "first-vote" to "2026-11-05", "votes-10" to "2026-11-07",
        )
        val progress = mapOf("streak-7" to 5, "streak-30" to 5, "goal-7" to 4, "words-10" to 7, "words-50" to 7)
        val list = AWARDS.map { award(it[0], earned[it[0]], progress[it[0]] ?: 0) }
        ru.teletau.core.network.models.MyAchievements(earned = list.count { it.earnedOn != null }, total = list.size, achievements = list)
    }

    /** Итог урока с новой наградой — «7 дней подряд» (как снимки веба awards-new). */
    val summaryWithAward: LessonRunSummary by lazy { summary.copy(newAchievements = listOf(award("streak-7", earnedOn = "2026-11-14"))) }
}
