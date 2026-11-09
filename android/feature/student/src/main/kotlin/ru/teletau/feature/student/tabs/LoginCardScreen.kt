package ru.teletau.feature.student.tabs

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.teletau.core.designsystem.AlertTone
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.HexAvatar
import ru.teletau.core.designsystem.InlineAlert
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauDialog
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LinkButton
import ru.teletau.core.designsystem.LinkTone
import ru.teletau.core.designsystem.LoadingBlock
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.avatarFor
import ru.teletau.core.designsystem.toneFor
import ru.teletau.core.network.models.AccountKind
import ru.teletau.core.network.models.LoginCard
import ru.teletau.core.network.models.Me
import ru.teletau.feature.student.common.LoadError
import ru.teletau.feature.student.common.QR_QUIET
import ru.teletau.feature.student.common.Resource
import ru.teletau.feature.student.common.cardFileName
import ru.teletau.feature.student.common.qrModules
import ru.teletau.feature.student.common.renderCardPng
import ru.teletau.feature.student.common.saveToGallery
import ru.teletau.feature.student.common.writeTo

/** QR личной карточки: цвета одинаковы в обеих темах — камеры не читают «негатив». */
@Composable
fun CardQr(payload: String, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    val m = remember(payload) { qrModules(payload) }
    Canvas(modifier.aspectRatio(1f).semantics { contentDescription = "QR-код карточки входа" }) {
        drawRect(c.highlight)
        val cell = size.width / (m.width + QR_QUIET * 2)
        for (y in 0 until m.height) for (x in 0 until m.width) {
            if (m[x, y]) drawRect(c.textOnFill, topLeft = Offset((x + QR_QUIET) * cell, (y + QR_QUIET) * cell), size = Size(cell + 0.5f, cell + 0.5f))
        }
    }
}

/**
 * «Моя карточка входа» (веб `/me/card`, ADR 0022): самостоятельный ученик входит в свой аккаунт на другом устройстве
 * по QR — тем же сканером, что и ученик класса. Показать, сохранить картинкой, сделать новую (старая перестаёт
 * работать, вход на других устройствах закрывается).
 */
@Composable
fun LoginCardView(
    me: Me,
    card: Resource<LoginCard?>,
    busy: Boolean,
    error: String?,
    confirm: Boolean,
    brand: String,
    host: String,
    onIssue: () -> Unit,
    onAskNew: () -> Unit,
    onCancelNew: () -> Unit,
    onReload: () -> Unit,
    onBack: () -> Unit,
    onSaved: (Boolean) -> Unit,
) {
    val c = TeleTauTheme.colors
    if (me.loginCard == null) {
        EmptyState(R.drawable.bee_idle, "Карточка не нужна", text = if (me.kind == AccountKind.adult) "Ты входишь по почте." else "Ты входишь по карточке от учителя.") {
            LinkButton("Назад", onBack, tone = LinkTone.Neutral)
        }
        return
    }
    when (card) {
        Resource.Loading -> LoadingBlock("Загружаем карточку", rows = 2)
        is Resource.Failed -> LoadError(card.error, onReload)
        is Resource.Ready -> {
            val data = card.data
            if (data == null) {
                EmptyState(R.drawable.bee_read, "Сделай карточку входа", text = "С ней войдёшь с любого устройства, мёд и серия сохранятся.") {
                    TeleTauButton("Сделать карточку", onIssue, Modifier.fillMaxWidth(), loading = busy)
                    if (error != null) InlineAlert(error, tone = AlertTone.Danger)
                }
                return
            }
            val context = LocalContext.current
            val scope = rememberCoroutineScope()
            var saving by remember { mutableStateOf(false) }
            var pending by remember { mutableStateOf<ByteArray?>(null) }
            val create = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
                val png = pending
                pending = null
                if (uri != null && png != null) onSaved(writeTo(context, uri, png))
            }
            Column(Modifier.padding(top = TeleTauSpace.s300), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s500)) {
                Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
                    KHeading("Моя карточка входа", TeleTauText.title2)
                    KText("На другом устройстве: «Я ученик» → «Сканировать карточку».", TeleTauText.body, color = c.textSecondary)
                }
                ru.teletau.core.designsystem.LippedSurfacePublic(onClick = null, face = c.surface, edge = c.accentSoftBorder, modifier = Modifier.fillMaxWidth(), radius = TeleTauRadius.card, lip = TeleTauSize.lip) {
                    Column(Modifier.fillMaxWidth().padding(TeleTauSpace.s500), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
                            HexAvatar(44.dp, tone = toneFor(me.nickname ?: me.id), art = avatarFor(me.nickname), lip = true)
                            KText(me.nickname.orEmpty(), TeleTauText.headline)
                        }
                        CardQr(data.payload, Modifier.widthIn(max = 260.dp).fillMaxWidth())
                        KText("Выпуск ${data.version}", TeleTauText.footnote, color = c.textTertiary, align = TextAlign.Center)
                    }
                }
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
                    Image(PhosphorIcons.IdentificationCardFill, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(c.accentFill))
                    KText("Не показывай карточку чужим.", TeleTauText.footnote, color = c.textSecondary)
                }
                if (error != null) InlineAlert(error, tone = AlertTone.Danger)
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s100), horizontalAlignment = Alignment.CenterHorizontally) {
                    TeleTauButton("Сохранить картинку", {
                        saving = true
                        scope.launch {
                            val png = withContext(Dispatchers.Default) { renderCardPng(context, data.payload, data.version, me.nickname.orEmpty(), brand, host) }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                onSaved(withContext(Dispatchers.IO) { saveToGallery(context, png, cardFileName(data.version)) })
                            } else {
                                pending = png
                                create.launch(cardFileName(data.version))
                            }
                            saving = false
                        }
                    }, Modifier.fillMaxWidth(), icon = PhosphorIcons.DownloadSimpleBold, loading = saving)
                    LinkButton("Сделать новую карточку", onAskNew, tone = LinkTone.Neutral, icon = PhosphorIcons.ArrowsClockwiseBold, enabled = !busy)
                }
            }
            if (confirm) {
                TeleTauDialog("Сделать новую карточку?", onDismiss = onCancelNew, description = "Старая перестанет работать.", art = R.drawable.bee_think) {
                    TeleTauButton("Сделать новую", onIssue, Modifier.fillMaxWidth(), loading = busy)
                    LinkButton("Отмена", onCancelNew, tone = LinkTone.Neutral)
                }
            }
        }
    }
}
