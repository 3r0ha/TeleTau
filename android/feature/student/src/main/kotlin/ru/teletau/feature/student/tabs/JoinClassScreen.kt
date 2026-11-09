package ru.teletau.feature.student.tabs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ru.teletau.core.designsystem.AlertTone
import ru.teletau.core.designsystem.ButtonVariant
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.InlineAlert
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LinkButton
import ru.teletau.core.designsystem.LinkTone
import ru.teletau.core.designsystem.R
import ru.teletau.core.network.models.AccountKind
import ru.teletau.core.network.models.Me
import ru.teletau.feature.student.login.CodeCellsField

/** Состояние вступления в класс. */
sealed interface JoinState {
    data object Code : JoinState
    data class Waiting(val classTitle: String, val error: String? = null) : JoinState
    data object Rejected : JoinState
    data object Expired : JoinState
}

/**
 * «Вступить в класс» (веб `/hive/join`, ADR 0022): ученик «Учусь сам» вводит код с доски — учитель видит заявку с его
 * ником и пускает в класс. Аккаунт тот же: мёд, серия и слова остаются, класс появляется во вкладке «Класс».
 */
@Composable
fun JoinClassView(me: Me, state: JoinState, code: String, codeError: String?, busy: Boolean, onCode: (String) -> Unit, onSubmit: () -> Unit, onAgain: () -> Unit) {
    when (state) {
        JoinState.Rejected, JoinState.Expired -> EmptyState(
            R.drawable.bee_sympathy,
            if (state == JoinState.Rejected) "Учитель не принял заявку" else "Заявка устарела",
            text = if (state == JoinState.Rejected) "Подойди к учителю и попробуй ещё раз." else "Попроси учителя показать код ещё раз.",
            alert = true,
        ) { TeleTauButton("Ввести код", onAgain, Modifier.fillMaxWidth()) }
        is JoinState.Waiting -> EmptyState(
            R.drawable.bee_idle, "Ждём учителя",
            richText = ru.teletau.feature.student.login.waitText(state.classTitle, me.nickname.orEmpty()),
        ) {
            state.error?.let { InlineAlert(it, tone = AlertTone.Danger) }
            LinkButton("Отменить", onAgain, tone = LinkTone.Neutral)
        }
        JoinState.Code -> Column(Modifier.padding(top = TeleTauSpace.s300), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s600)) {
            Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
                KHeading("Введи код класса", TeleTauText.title2)
                KText("Он на доске. Мёд и серия останутся с тобой.", TeleTauText.body, color = TeleTauTheme.colors.textSecondary)
            }
            CodeCellsField(code, onCode, onSubmit, codeError)
            TeleTauButton("Отправить заявку", onSubmit, Modifier.fillMaxWidth(), enabled = code.length >= 6, loading = busy)
        }
    }
}

/** Вкладка «Класс» без класса: ребёнку — «Вступить в класс», взрослому — в лигу. */
@Composable
fun NoClassView(me: Me, onJoin: () -> Unit, onLeague: () -> Unit) {
    if (me.kind == AccountKind.child) {
        EmptyState(R.drawable.scene_class_hive, "Класса пока нет", text = "Попроси у учителя код класса.") {
            TeleTauButton("Вступить в класс", onJoin, Modifier.fillMaxWidth())
        }
    } else {
        EmptyState(R.drawable.bee_idle, "Класс — для школьников", text = "Соревнуйся в лиге.") {
            TeleTauButton("В лигу", onLeague, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary)
        }
    }
}
