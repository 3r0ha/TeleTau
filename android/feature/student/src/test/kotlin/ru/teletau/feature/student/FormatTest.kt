package ru.teletau.feature.student

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.teletau.feature.student.common.dueForStudent
import ru.teletau.feature.student.learn.achievementLabel
import ru.teletau.feature.student.learn.badgeTone
import ru.teletau.feature.student.common.plural
import ru.teletau.feature.student.common.resolveAudioUrl
import ru.teletau.feature.student.common.sessionEndedText
import ru.teletau.feature.student.common.ufaToday

/** Подписи и адреса: срок задания (как dueForStudent веба), адрес записи, русское множественное, сутки по Уфе. */
class FormatTest {
    @Test
    fun sessionEnd_reasons_notMasked() {
        // Блокировка аккаунта не маскируется под «войди снова» (M2-UX5, как в словаре веба).
        assertEquals("Аккаунт заблокирован. Обратитесь к администрации.", sessionEndedText("account_blocked"))
        assertEquals("Вход завершён. Войди снова по карточке.", sessionEndedText("session_revoked"))
        assertEquals("Вход завершён. Войди снова.", sessionEndedText("неизвестный-код"))
    }

    @Test
    fun audioUrl_absoluteAsIs_relativeFromWebBase() {
        assertEquals("https://upload.wikimedia.org/a.ogg", resolveAudioUrl("https://upload.wikimedia.org/a.ogg", null))
        assertEquals("http://192.168.1.10:3000/audio/x.m4a", resolveAudioUrl("/audio/x.m4a", "http://192.168.1.10:3000/"))
        assertEquals("http://h:3000/audio/x.m4a", resolveAudioUrl("audio/x.m4a", "http://h:3000"))
        assertNull("без адреса сайта относительную запись сыграть негде", resolveAudioUrl("/audio/x.m4a", null))
        assertNull(resolveAudioUrl("", "http://h"))
    }

    @Test
    fun webBase_derivedFromApi() {
        assertEquals("http://192.168.1.10:3000", webBaseFor("http://192.168.1.10:4000"))
        assertEquals("https://teletau.study", webBaseFor("https://teletau.study/"))
    }

    @Test
    fun dueForStudent_likeWeb() {
        val today = "2026-11-05" // четверг
        assertEquals("сегодня последний день", dueForStudent("2026-11-05", today))
        assertEquals("до завтра", dueForStudent("2026-11-06", today))
        assertEquals("до сб", dueForStudent("2026-11-07", today))
        assertEquals("до 19 ноября", dueForStudent("2026-11-19", today))
    }

    @Test
    fun ufaDay_and_plural() {
        // 2026-11-04 20:00 UTC — уже 5 ноября в Уфе (UTC+5).
        assertEquals("2026-11-05", ufaToday(1_793_822_400_000))
        assertEquals(listOf("слово", "слова", "слов", "слов"), listOf(1, 3, 5, 11).map { plural(it, "слово", "слова", "слов") })
    }

    @Test
    fun lockedHint_namesThePreviousOpenLesson() {
        val course = ru.teletau.feature.student.preview.Demo.course
        assertEquals("Сначала пройди «Моя школа»", ru.teletau.feature.student.learn.lockedHint(course, "u01-vezhlivye-slova"))
        assertEquals("Сначала пройди предыдущие уроки", ru.teletau.feature.student.learn.lockedHint(course, "u01-ispytanie"))
    }

    @Test
    fun dictionaryStatus_inProfile() {
        val w = ru.teletau.feature.student.preview.Demo.words
        assertEquals("Повторить 3 слова", ru.teletau.feature.student.tabs.dictionaryStatus(w))
        assertEquals(listOf("Повторить 1 слово", "Повторить 2 слова", "Повторить 5 слов"), listOf(1, 2, 5).map { ru.teletau.feature.student.learn.reviewTitle(it) })
        assertEquals("Все слова выучены", ru.teletau.feature.student.tabs.dictionaryStatus(w.copy(summary = w.summary.copy(review = 0))))
        assertEquals("Пока пусто", ru.teletau.feature.student.tabs.dictionaryStatus(w.copy(summary = w.summary.copy(total = 0, review = 0, learned = 0), words = emptyList())))
        assertEquals("7 слов", ru.teletau.feature.student.tabs.wordsSummary(w.copy(summary = w.summary.copy(total = 7))))
    }

    @Test
    fun achievements_dayLabelToneAndIcon() {
        val demo = ru.teletau.feature.student.preview.Demo
        assertEquals("5 ноября", ru.teletau.feature.student.common.dayLong("2026-11-05"))
        assertEquals("", ru.teletau.feature.student.common.dayLong("не дата"))
        val label = ::achievementLabel
        assertEquals("7 дней подряд, получена 5 ноября", label(demo.award("streak-7", earnedOn = "2026-11-05")))
        assertEquals("7 дней подряд, 5 из 7", label(demo.award("streak-7", progress = 5)))
        assertEquals("Место пройдено, ещё не получена", label(demo.award("first-place")))
        val tone = ::badgeTone
        assertEquals(ru.teletau.feature.student.learn.BadgeTone.Locked, tone(demo.award("streak-7", progress = 5)))
        assertEquals(ru.teletau.feature.student.learn.BadgeTone.Streak, tone(demo.award("streak-7", earnedOn = "2026-11-05")))
        // Незнакомый значок — звезда и медовый тон.
        val unknown = demo.award("first-lesson", earnedOn = "2026-11-03").copy(id = "new-thing", icon = "rocket")
        assertEquals(ru.teletau.feature.student.learn.BadgeTone.Honey, tone(unknown))
        assertEquals(ru.teletau.feature.student.learn.achievementIcon("star"), ru.teletau.feature.student.learn.achievementIcon("rocket"))
        assertEquals(5 to 12, demo.achievements.earned to demo.achievements.total)
    }

    @Test
    fun uiSounds_areShortQuietAndNotSilent() {
        for (s in ru.teletau.feature.student.common.UiSound.entries) {
            val pcm = ru.teletau.feature.student.common.SoundSynth.render(s)
            val ms = pcm.size * 1000L / ru.teletau.feature.student.common.SoundSynth.SAMPLE_RATE
            assertTrue("$s: $ms мс", ms in 60..1700)
            val peak = pcm.maxOf { kotlin.math.abs(it.toInt()) }
            assertTrue("$s слышен: $peak", peak > 2_000)
            assertTrue("$s без перегруза: $peak", peak < Short.MAX_VALUE * 0.95)
            assertEquals("$s начинается с тишины, без щелчка", 0, pcm.first().toInt())
        }
        assertTrue(ru.teletau.feature.student.common.SoundSynth.durationMs(ru.teletau.feature.student.common.UiSound.Tap) < 150)
    }

    @Test
    fun hintSpans_searchFromPreviousEnd_skipMissing() {
        fun h(t: String) = ru.teletau.core.network.models.PromptHint(t, ru.teletau.core.network.models.BaString("x", ru.teletau.core.network.models.ReviewStatus.needsNativeReview))
        val spans = ru.teletau.feature.student.learn.hintSpans("Школа и школа рядом", listOf(h("школа"), h("рядом"), h("лес")))
        assertEquals(listOf(8 to 13, 14 to 19), spans.map { it.start to it.end })
        // Одна и та же подстрока дважды: вторая подсказка — после первой, а не там же.
        assertEquals(listOf(0 to 2, 3 to 5), ru.teletau.feature.student.learn.hintSpans("да да", listOf(h("да"), h("да"))).map { it.start to it.end })
        assertEquals(emptyList<Any>(), ru.teletau.feature.student.learn.hintSpans("тетрадь", null))
    }
}
