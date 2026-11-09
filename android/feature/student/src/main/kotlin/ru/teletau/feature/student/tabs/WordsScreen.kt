package ru.teletau.feature.student.tabs

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import ru.teletau.core.designsystem.ChipTone
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauChip
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.SpeakSize
import ru.teletau.core.network.models.MyWord
import ru.teletau.core.network.models.MyWords
import ru.teletau.core.network.models.WordStatus
import ru.teletau.feature.student.common.Listen
import ru.teletau.feature.student.common.plural
import ru.teletau.feature.student.learn.ReviewCard

/** Шапка словаря: «7 слов». */
fun wordsSummary(words: MyWords): String {
    val total = words.summary.total
    return "$total ${plural(total, "слово", "слова", "слов")}"
}

/** Подпись «Мой словарь» в профиле: «Повторить 3 слова», «Все слова выучены» или «Пока пусто». */
fun dictionaryStatus(words: MyWords?): String? = when {
    words == null -> null
    words.summary.review > 0 -> ru.teletau.feature.student.learn.reviewTitle(words.summary.review)
    words.summary.total > 0 -> "Все слова выучены"
    else -> "Пока пусто"
}

/**
 * «Мой словарь» (веб `/words`): слова из пройденных уроков — башкирское слово (из API, с флагом проверки носителем),
 * перевод; разделы «На повторение» и «Выучено». Запись носителя — «Послушать». Вход — из профиля.
 */
@Composable
fun WordsView(words: MyWords, onBack: () -> Unit, onReview: () -> Unit, onTrail: () -> Unit) {
    val c = TeleTauTheme.colors
    val total = words.summary.total
    val review = words.summary.review
    Column {
        Column(Modifier.padding(top = TeleTauSpace.s300, bottom = TeleTauSpace.s200)) {
            Row(
                Modifier.defaultMinSize(minHeight = TeleTauSize.touchMin).clip(RoundedCornerShape(TeleTauRadius.small))
                    .clickable(role = Role.Button, onClick = onBack).padding(horizontal = TeleTauSpace.s100),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s100),
            ) {
                Image(PhosphorIcons.CaretLeftBold, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(c.accentText))
                KText("Профиль", TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote), color = c.accentText)
            }
            KHeading("Мой словарь", TeleTauText.title2)
            if (total > 0) KText(wordsSummary(words), TeleTauText.callout, Modifier.padding(top = TeleTauSpace.s100), color = c.textSecondary)
        }
        if (total == 0) {
            EmptyState(R.drawable.empty_all_done, "Слов пока нет", text = "Они появятся после урока.", compact = true) {
                TeleTauButton("На тропу", onTrail, Modifier.fillMaxWidth())
            }
        }
        if (review > 0) Box(Modifier.padding(top = TeleTauSpace.s200)) { ReviewCard(review, onReview, highlighted = true) }
        val toReview = words.words.filter { it.status == WordStatus.review }
        val learned = words.words.filter { it.status == WordStatus.learned }
        if (toReview.isNotEmpty()) WordList("На повторение", toReview)
        if (learned.isNotEmpty()) WordList("Выучено", learned)
    }
}

@Composable
private fun WordList(title: String, words: List<MyWord>) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.card)
    Column(Modifier.padding(top = TeleTauSpace.s500)) {
        KText(title.uppercase(), TeleTauText.label.copy(letterSpacing = 0.04.em), Modifier.padding(bottom = TeleTauSpace.s200).semantics { heading() }, color = c.textTertiary)
        Column(Modifier.fillMaxWidth().clip(shape).background(c.surface).border(TeleTauSpace.s050, c.borderSubtle, shape)) {
            words.forEachIndexed { i, w ->
                if (i > 0) Box(Modifier.fillMaxWidth().height(TeleTauSpace.s050).background(c.borderSubtle))
                Row(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = 64.dp)
                        .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s300, top = TeleTauSpace.s200, bottom = TeleTauSpace.s200),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250),
                ) {
                    Column(
                        Modifier.weight(1f).semantics(mergeDescendants = true) {
                            contentDescription = "${w.word.text} — ${w.translationRu}, " + if (w.status == WordStatus.review) "на повторение" else "выучено"
                        },
                        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s050),
                    ) {
                        KText(w.word.text, TeleTauText.bashkir(TeleTauFontSize.headline, TeleTauFontWeight.black))
                        KText(w.translationRu, TeleTauText.footnote, color = c.textSecondary)
                    }
                    Listen(w.word.audio, size = SpeakSize.Small, label = "Послушать: ${w.word.text}")
                }
            }
        }
    }
}
