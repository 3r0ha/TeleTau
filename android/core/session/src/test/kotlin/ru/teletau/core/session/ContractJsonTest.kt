package ru.teletau.core.session

import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import ru.teletau.core.network.models.AttemptAnswer
import ru.teletau.core.network.models.AttemptRequest
import ru.teletau.core.network.models.DuelAnswer
import ru.teletau.core.network.models.DuelChoice
import ru.teletau.core.network.models.DuelExerciseType
import ru.teletau.core.network.models.LessonRun
import ru.teletau.core.network.models.LessonRunSummary
import ru.teletau.core.network.models.RunExercise
import ru.teletau.core.network.models.TextAnswer
import ru.teletau.core.network.models.TextAnswerType
import ru.teletau.core.network.models.TilesAnswer
import ru.teletau.core.network.models.TilesAnswerType

/**
 * Сгенерированные модели и JSON контракта: `oneOf` упражнений и ответов (поле `type`), открытость ответов для новых
 * полей, числовой `multiplier`, отсутствие `null` в запросах (сервер не принимает лишних полей).
 */
class ContractJsonTest {

    @Test
    fun lessonRun_decodesAllExerciseKinds() {
        val run = TeleTauJson.decodeFromString(
            LessonRun.serializer(),
            """
            {"runId":"0190a8c0-0000-7000-8000-000000000001","lessonId":"u1-l3","kind":"review","titleRu":"Моя школа","status":"active",
             "startedAt":"2026-11-04T10:00:00Z","newField":true,"exercises":[
              {"id":"e1","type":"tiles_ru_ba","review":"needs_native_review","promptRu":"Средняя школа","tiles":[{"id":"t1","text":"Урта"},{"id":"t2","text":"мәктәп"}]},
              {"id":"e2","type":"choice_ba_ru","review":"needs_native_review","prompt":"мәктәп","promptAudio":{"url":"/audio/x.m4a","source":{"title":"Lingua Libre"}},"options":[{"id":"o1","textRu":"школа"},{"id":"o2","textRu":"книга"}]},
              {"id":"e3","type":"free_ru_ba","review":"needs_native_review","promptRu":"тетрадь","letters":["ә","ө","ү","ғ","ҡ","ң","ҙ","ҫ","һ"]},
              {"id":"e4","type":"duel","review":"needs_native_review","itemId":"0190a8c0-0000-7000-8000-0000000000aa","sourceRu":"Здравствуйте!","a":"Һаумыһығыҙ!","b":"Иҫәнмеһегеҙ!"},
              {"id":"e5","type":"match_pairs","review":"needs_native_review","left":[{"id":"l1","text":"китап"},{"id":"l2","text":"мәктәп"}],"right":[{"id":"r1","textRu":"школа"},{"id":"r2","textRu":"книга"}]},
              {"id":"w1","type":"word_intro","review":"needs_native_review","word":{"text":"мәктәп","review":"needs_native_review","audio":{"url":"/audio/x.m4a"}},"translationRu":"школа"},
              {"id":"e6","type":"free_ru_ba","review":"needs_native_review","promptRu":"Средняя школа","letters":[],"hints":[{"text":"школа","translation":{"text":"мәктәп","review":"needs_native_review"}}]}
            ]}
            """.trimIndent(),
        )
        val kinds = run.exercises.map {
            when (it) {
                is RunExercise.TilesRuBaWrapper -> "tiles:" + it.value.tiles.size
                is RunExercise.ChoiceBaRuWrapper -> "choice:" + it.value.prompt + "@" + it.value.promptAudio?.url
                is RunExercise.FreeRuBaWrapper -> "free:" + it.value.letters.size
                is RunExercise.DuelWrapper -> "duel:" + it.value.b
                is RunExercise.MatchPairsWrapper -> "pairs:" + it.value.left.size
                is RunExercise.WordIntroWrapper -> "intro:" + it.value.word.text + "=" + it.value.translationRu + "@" + it.value.word.audio?.url
            }
        }
        assertEquals(listOf("tiles:2", "choice:мәктәп@/audio/x.m4a", "free:9", "duel:Иҫәнмеһегеҙ!", "pairs:2", "intro:мәктәп=школа@/audio/x.m4a", "free:0"), kinds)
        val hint = (run.exercises.last() as RunExercise.FreeRuBaWrapper).value.hints?.single()
        assertEquals("школа→мәктәп", hint?.text + "→" + hint?.translation?.text)
    }

    @Test
    fun startLessonRun_asksForWordIntroCards() {
        assertEquals(
            """{"runId":"r1","accepts":["word_intro"]}""",
            TeleTauJson.encodeToString(ru.teletau.core.network.models.StartLessonRunRequest.serializer(), ru.teletau.core.network.models.StartLessonRunRequest("r1", setOf(ru.teletau.core.network.models.RunFeature.wordIntro))),
        )
        assertEquals("""{"runId":"r2"}""", TeleTauJson.encodeToString(ru.teletau.core.network.models.StartLessonRunRequest.serializer(), ru.teletau.core.network.models.StartLessonRunRequest("r2")))
    }

    @Test
    fun attemptRequest_encodesOnlyContractFields() {
        val tiles = AttemptRequest(attemptId = "a1", exerciseId = "e1", answer = AttemptAnswer.TilesWrapper(TilesAnswer(TilesAnswerType.tiles, listOf("t2", "t1"))), latencyMs = 1200)
        assertEquals(
            """{"attemptId":"a1","exerciseId":"e1","answer":{"type":"tiles","tileIds":["t2","t1"]},"latencyMs":1200}""",
            TeleTauJson.encodeToString(AttemptRequest.serializer(), tiles),
        )
        val text = AttemptRequest(attemptId = "a2", exerciseId = "e3", answer = AttemptAnswer.TextWrapper(TextAnswer(TextAnswerType.text, "дафтәр")))
        assertEquals("""{"attemptId":"a2","exerciseId":"e3","answer":{"type":"text","text":"дафтәр"}}""", TeleTauJson.encodeToString(AttemptRequest.serializer(), text))
        val duel = AttemptRequest(attemptId = "a3", exerciseId = "e4", answer = AttemptAnswer.DuelWrapper(DuelAnswer(DuelExerciseType.duel, DuelChoice.both)))
        val answer = TeleTauJson.parseToJsonElement(TeleTauJson.encodeToString(AttemptRequest.serializer(), duel)).jsonObject.getValue("answer").toString()
        assertEquals("""{"type":"duel","choice":"both"}""", answer)
    }

    @Test
    fun summary_readsNumericMultiplierAndLeagueResult() {
        val summary = TeleTauJson.decodeFromString(
            LessonRunSummary.serializer(),
            """
            {"runId":"r","lessonId":"l","honey":{"total":16,"base":10,"firstTry":6,"multiplier":0.5,"pendingFromVotes":3},"accuracy":0.857,
             "durationSeconds":161,"newWords":[{"text":"мәктәп","review":"needs_native_review"}],"votes":1,
             "streak":{"current":6,"longest":6,"freezes":2,"extendedToday":true,"today":"2026-11-04","week":[
               {"date":"2026-11-02","status":"done"},{"date":"2026-11-03","status":"done"},{"date":"2026-11-04","status":"done"},
               {"date":"2026-11-05","status":"future"},{"date":"2026-11-06","status":"future"},{"date":"2026-11-07","status":"future"},{"date":"2026-11-08","status":"future"}]},
             "leagueResult":{"weekStart":"2026-10-26","tierBefore":"sweetclover","tierAfter":"fireweed","outcome":"promoted","rank":4,"points":318}}
            """.trimIndent(),
        )
        assertEquals(0.5, summary.honey.multiplier)
        assertEquals("fireweed", summary.leagueResult?.tierAfter?.value)
        assertEquals(7, summary.streak.week.size)
    }
}
