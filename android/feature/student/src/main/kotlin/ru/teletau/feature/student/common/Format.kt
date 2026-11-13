package ru.teletau.feature.student.common

import ru.teletau.core.network.models.LeagueTier
import ru.teletau.core.session.ApiProblem
import ru.teletau.core.session.NetworkFailure
import ru.teletau.core.session.isShortRateLimit
import java.time.LocalDate
import java.time.OffsetDateTime
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToInt

/** Русское множественное число: plural(5, "день", "дня", "дней") → «дней» (как format.ts веба). */
fun plural(n: Int, one: String, few: String, many: String): String {
    val a = abs(n) % 100
    val b = a % 10
    return when {
        a in 11..19 -> many
        b == 1 -> one
        b in 2..4 -> few
        else -> many
    }
}

/** «2:41» — время урока. */
fun duration(seconds: Int): String {
    val s = seconds.coerceAtLeast(0)
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

/** Лиги медоносов: именительный («Новая лига — Кипрей!») и родительный («Лига Донника») падежи. */
data class TierName(val nom: String, val gen: String)

val TIER_NAMES: Map<LeagueTier, TierName> = mapOf(
    LeagueTier.clover to TierName("Клевер", "Клевера"),
    LeagueTier.buckwheat to TierName("Гречиха", "Гречихи"),
    LeagueTier.sweetclover to TierName("Донник", "Донника"),
    LeagueTier.fireweed to TierName("Кипрей", "Кипрея"),
    LeagueTier.linden to TierName("Липа", "Липы"),
)

val LEAGUE_TIERS: List<LeagueTier> = listOf(LeagueTier.clover, LeagueTier.buckwheat, LeagueTier.sweetclover, LeagueTier.fireweed, LeagueTier.linden)

/** «через 3 дня» / «сегодня» до конца недели лиги. */
fun weekEndsIn(weekEndsAt: String, nowMillis: Long = System.currentTimeMillis()): String {
    val end = runCatching { OffsetDateTime.parse(weekEndsAt).toInstant().toEpochMilli() }.getOrNull() ?: return "сегодня"
    val days = ceil((end - nowMillis) / 86_400_000.0).roundToInt()
    if (days <= 1) return "сегодня"
    return "через $days ${plural(days, "день", "дня", "дней")}"
}

private val WEEKDAYS = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")

/** «Пн» для даты учебных суток YYYY-MM-DD (сутки уже посчитаны сервером по Уфе — здесь только день недели). */
fun weekdayShort(date: String): String = runCatching { WEEKDAYS[LocalDate.parse(date).dayOfWeek.value - 1] }.getOrDefault("")

/** Сеть недоступна. */
fun Throwable.isNetwork(): Boolean = this is NetworkFailure

private val CHILD: Map<String, String> = mapOf(
    "card_invalid" to "Карточка не найдена. Покажи её учителю.",
    "card_revoked" to "Эта карточка больше не действует. Возьми у учителя новую.",
    "card_reissued" to "У тебя новая карточка. Войди по ней.",
    "session_revoked" to "Вход завершён. Войди снова по карточке.",
    "account_blocked" to "Аккаунт заблокирован. Обратитесь к администрации.",
    "refresh_reused" to "Вход завершён. Войди снова по карточке.",
    "refresh_invalid" to "Вход завершён. Войди снова по карточке.",
    "consent_revoked" to "Вход по этой карточке закрыт. Подойди к учителю.",
    "class_archived" to "Этот класс закрыт. Подойди к учителю.",
    "payload_invalid" to "Это не карточка ученика. Покажи свою карточку.",
    "class_code_not_found" to "Код не подходит. Проверь буквы или попроси новый код.",
    "rate_limited" to "Много попыток. Подожди минуту.",
    "join_queue_full" to "У учителя много заявок. Попробуй чуть позже.",
    "nickname_not_allowed" to "Этот ник нельзя выбрать. Выбери другой.",
    "join_request_closed" to "Заявка закрыта. Введи код ещё раз.",
    "request_in_progress" to "Отправляем, подожди секунду.",
    "login_card_unavailable" to "Входи по карточке от учителя.",
)

/** Понятный ребёнку текст ошибки (на «ты»), как describeProblem(e, "child") в packages/session. */
fun describeForChild(e: Throwable?): String {
    if (e is NetworkFailure) return "Нет связи. Проверь интернет."
    if (e !is ApiProblem) return "Что-то сломалось. Попробуй ещё раз."
    if (e.isShortRateLimit()) return "Секунду, много входов. Попробуй ещё раз."
    e.code?.let { CHILD[it] }?.let { return it }
    return when (e.status) {
        401 -> "Нужно войти заново."
        403 -> "Сюда нельзя."
        404 -> "Ничего не нашлось."
        409 -> "Так сделать сейчас нельзя."
        410 -> "Это больше недоступно."
        422 -> e.problem?.errors?.firstOrNull()?.detail?.takeIf { d -> d.any { it in 'А'..'я' || it == 'Ё' || it == 'ё' } } ?: "Проверь, что всё заполнено."
        429 -> CHILD.getValue("rate_limited")
        503 -> "Сервер недоступен. Попробуй через минуту."
        else -> "Что-то сломалось. Попробуй ещё раз."
    }
}

/** Текст причины, по которой сервер закончил сессию (экран входа после неё). */
fun sessionEndedText(reason: String?): String? = reason?.let { CHILD[it] ?: "Вход завершён. Войди снова." }

/** Учебные сутки — по Уфе (CLAUDE.md, «Соглашения»): сегодняшняя дата YYYY-MM-DD. */
fun ufaToday(nowMillis: Long = System.currentTimeMillis()): String =
    java.time.Instant.ofEpochMilli(nowMillis).atZone(java.time.ZoneId.of("Asia/Yekaterinburg")).toLocalDate().toString()

private val SHORT_DAYS = listOf("пн", "вт", "ср", "чт", "пт", "сб", "вс")
private val MONTHS_GEN = listOf("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря")

/** Срок задания для ученика (как dueForStudent веба): «до пт», «до завтра», «сегодня последний день», «до 12 ноября». */
fun dueForStudent(dueOn: String, today: String): String {
    val due = runCatching { LocalDate.parse(dueOn) }.getOrNull() ?: return ""
    val now = runCatching { LocalDate.parse(today) }.getOrNull() ?: return ""
    val days = java.time.temporal.ChronoUnit.DAYS.between(now, due)
    return when {
        days <= 0 -> "сегодня последний день"
        days == 1L -> "до завтра"
        days < 7 -> "до ${SHORT_DAYS[due.dayOfWeek.value - 1]}"
        else -> "до ${due.dayOfMonth} ${MONTHS_GEN[due.monthValue - 1]}"
    }
}

/** Что задано: «Моя школа» в кавычках, «Испытание места «Уфа»» или «Повторить слова». */
fun assignmentTitle(a: ru.teletau.core.network.models.StudentAssignment): String = when (a.kind) {
    ru.teletau.core.network.models.AssignmentKind.review -> a.titleRu
    ru.teletau.core.network.models.AssignmentKind.placeTest -> a.placeRu?.let { "Испытание места «$it»" } ?: a.titleRu
    ru.teletau.core.network.models.AssignmentKind.lesson -> "«${a.titleRu}»"
}

/** «5 ноября» — день учебных суток YYYY-MM-DD (сервер уже посчитал его по Уфе); не дата — пусто. */
fun dayLong(date: String): String {
    val d = runCatching { LocalDate.parse(date) }.getOrNull() ?: return ""
    return "${d.dayOfMonth} ${MONTHS_GEN[d.monthValue - 1]}"
}
