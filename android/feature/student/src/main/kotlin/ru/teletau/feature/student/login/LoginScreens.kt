package ru.teletau.feature.student.login

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.teletau.core.authcodes.Crockford
import ru.teletau.core.designsystem.AlertTone
import ru.teletau.core.designsystem.BashkirLocale
import ru.teletau.core.designsystem.ButtonVariant
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.HexAvatar
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.IllustrationFill
import ru.teletau.core.designsystem.InlineAlert
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.FitText
import ru.teletau.core.designsystem.scaledBy
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauCard
import ru.teletau.core.designsystem.TeleTauChip
import ru.teletau.core.designsystem.TeleTauDialog
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauIconButton
import ru.teletau.core.designsystem.TeleTauProgressBar
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LinkButton
import ru.teletau.core.designsystem.LinkTone
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.SimpleTopBar
import ru.teletau.core.designsystem.SkeletonBlock
import ru.teletau.core.designsystem.avatarFor
import ru.teletau.core.designsystem.toneFor
import ru.teletau.core.network.models.Me
import ru.teletau.core.network.models.NicknameSuggestion
import ru.teletau.core.network.models.PhraseOfDayPair
import ru.teletau.feature.student.common.Resource
import ru.teletau.feature.student.common.describeForChild
import ru.teletau.feature.student.tabs.studentClass

/** Колонка экрана входа: прокрутка, ширина колонки, отступы, клавиатура не закрывает поля. */
@Composable
internal fun Screen(top: @Composable () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(TeleTauTheme.colors.bg).windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
        top()
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s400),
                verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s600),
                content = content,
            )
        }
    }
}

@Composable
private fun Head(title: String, lead: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
        KHeading(title, TeleTauText.title2)
        if (lead != null) KText(lead, TeleTauText.bodyLarge.copy(fontSize = TeleTauFontSize.body), color = TeleTauTheme.colors.textSecondary)
    }
}

/** Путь на старте (веб `.start-way`): плитка с картинкой серии, названием и строкой пояснения. */
@Composable
private fun StartWay(art: Int, title: String, text: String, onClick: () -> Unit) {
    val c = TeleTauTheme.colors
    ru.teletau.core.designsystem.LippedSurfacePublic(
        onClick = onClick, face = c.surface, edge = c.borderDefault,
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "$title. $text" },
        minHeight = 88.dp,
        radius = TeleTauRadius.card,
        lip = TeleTauSize.lip,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = TeleTauSpace.s200, end = TeleTauSpace.s400, top = TeleTauSpace.s200, bottom = TeleTauSpace.s200),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        ) {
            Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) { Illustration(art, 72.dp) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s050)) {
                FitText(title, TeleTauText.title3.copy(lineHeight = 1.15.em))
                FitText(text, TeleTauText.footnote, color = c.textSecondary, maxLines = 3)
            }
            Image(PhosphorIcons.CaretRightBold, null, Modifier.size(TeleTauSize.icon), colorFilter = ColorFilter.tint(c.accentLip))
        }
    }
}

/**
 * Старт (веб `/`, self/50-start): пейзаж с пчелой и брендом, два пути ученика — «Я ученик» (класс: карточка или код от
 * учителя) и «Учусь сам» (без школы) — и «Я учитель» (кабинет — на сайте). Под заголовком — карточка «фразы дня»
 * ([phrase], веб `.lp-hero__hello`): есть пара — пчела «произносит» её, нет — старт без карточки. Внизу — вход для тех,
 * кто уже учится сам: по карточке (сканер) или по почте (на сайте). [ended] — сервер завершил прошлую сессию:
 * объясняем, что делать.
 */
@Composable
fun WelcomeScreen(
    brand: String,
    ended: String?,
    phrase: PhraseOfDayPair?,
    onStudent: () -> Unit,
    onSelf: () -> Unit,
    onTeacher: () -> Unit,
    onCard: () -> Unit,
    onEmail: () -> Unit,
    onSettings: () -> Unit,
) {
    val c = TeleTauTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg).verticalScroll(rememberScrollState())) {
        // Картинка уходит под строку состояния вместе с надписью: небо слева — всегда над надписью, памятник — ниже.
        val inset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
        val brandStyle = TeleTauText.display.copy(localeList = BashkirLocale, lineHeight = 1.em)
        val sloganStyle = TeleTauText.body.copy(fontFamily = ru.teletau.core.designsystem.TeleTauFonts.display, fontWeight = ru.teletau.core.designsystem.TeleTauFontWeight.extrabold)
        val slogan = "Башкирский язык каждый день"
        val measurer = androidx.compose.ui.text.rememberTextMeasurer()
        val density = androidx.compose.ui.platform.LocalDensity.current
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val heroW = maxWidth
            val heroH = 330.dp + inset
            // Где на картинке рисунок (доли картинки hero_landing 1376×768): памятник — x 0,50…0,56, верх y 0,355;
            // пчела — от x 0,61; холмы слева — от y 0,46. Картинка заполняет блок (Crop, по горизонтали 0,6, низ).
            val byHeight = heroW <= heroH * (1376f / 768f)
            val imgW = if (byHeight) heroH * (1376f / 768f) else heroW
            val imgH = if (byHeight) heroH else heroW * (768f / 1376f)
            fun x(f: Float) = imgW * f - (imgW - heroW) * 0.8f
            fun y(f: Float) = imgH * f - (imgH - heroH)
            val textTop = inset + TeleTauSpace.s500
            val gap = TeleTauSpace.s200
            // Два ровных места на небе: над памятником (до пчелы) и левее памятника (до холмов).
            val zones = listOf(
                minOf(200.dp, x(0.61f) - gap - TeleTauSpace.s500) to (y(0.355f) - gap - textTop),
                (x(0.50f) - gap - TeleTauSpace.s500) to (y(0.46f) - gap - textTop),
            )
            val fit = remember(brand, heroW, heroH, density) {
                with(density) {
                    zones.firstNotNullOfOrNull { (w, h) ->
                        if (w <= 0.dp || h <= 0.dp) null
                        else ru.teletau.core.designsystem.fitBlock(
                            measurer, listOf(brand to brandStyle, slogan to sloganStyle),
                            maxWidth = w.roundToPx(), maxHeight = h.roundToPx(), extraHeight = TeleTauSpace.s150.roundToPx(), maxLines = 3, minScale = 0.8f,
                        )?.let { k -> k to w }
                    }
                }
            }
            val scale = fit?.first
            val skyW = fit?.second ?: 0.dp
            val text: @Composable (androidx.compose.ui.graphics.Color, Float) -> Unit = { ink, k ->
                KText(brand, brandStyle.scaledBy(k), Modifier.semantics { heading() }, color = ink, maxLines = 1)
                KText(slogan, sloganStyle.scaledBy(k), color = ink, maxLines = 3)
            }
            Column {
                Box(Modifier.fillMaxWidth().height(330.dp + inset).background(c.accentSoft)) {
                    IllustrationFill(R.drawable.hero_landing, imgW, Modifier.fillMaxSize(), alignment = androidx.compose.ui.BiasAlignment(0.6f, 1f))
                    if (scale != null) {
                        Column(
                            Modifier.padding(start = TeleTauSpace.s500, top = inset + TeleTauSpace.s500).width(skyW),
                            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
                        ) { text(c.textOnFill, scale) }
                    }
                    Box(Modifier.align(Alignment.TopEnd).padding(top = inset).padding(TeleTauSpace.s200)) {
                        Box(Modifier.background(c.surface.copy(alpha = 0.85f), RoundedCornerShape(TeleTauRadius.iconButton))) {
                            TeleTauIconButton(PhosphorIcons.GearSixFill, "Адрес сервера", onSettings)
                        }
                    }
                }
                // Крупный шрифт или узкий экран: на небе надпись не помещается — она под картинкой, целиком.
                if (scale == null) {
                    Column(
                        Modifier.padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s400),
                        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
                    ) {
                        FitText(brand, brandStyle, Modifier.semantics(mergeDescendants = true) { heading() }, color = c.textPrimary, maxLines = 1)
                        FitText(slogan, sloganStyle, color = c.textPrimary, maxLines = 3)
                    }
                }
            }
        }
        Column(
            Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth().align(Alignment.CenterHorizontally)
                .padding(horizontal = TeleTauSpace.s400).padding(top = TeleTauSpace.s800, bottom = TeleTauSpace.s800)
                .semantics { contentDescription = "Кто ты?" },
            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        ) {
            if (phrase != null) PhraseOfDayCard(phrase)
            if (ended != null) InlineAlert(ended)
            StartWay(R.drawable.scene_class_hive, "Я ученик", "С классом: карточка или код", onStudent)
            StartWay(R.drawable.bee_read, "Учусь сам", "Без класса, в любом возрасте", onSelf)
            StartWay(R.drawable.bee_teacher, "Я учитель", "Класс и задания", onTeacher)
            @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
            androidx.compose.foundation.layout.FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                KText("Войти:", TeleTauText.footnote, color = c.textSecondary)
                TextLink("по карточке", onCard)
                KText("·", TeleTauText.footnote, color = c.textSecondary)
                TextLink("по почте", onEmail)
            }
        }
    }
}

/**
 * Карточка «фразы дня» на старте (веб `/`, ТЗ §3.6): башкирский вариант крупно (Nunito, локаль `ba` — формы Ҫ и Ҙ,
 * как текст урока), ниже русский исходник мелко в ёлочках. Длинная фраза на узком экране — шрифт уменьшается
 * ([FitText]), карточка не наезжает на кнопки путей: колонка прокручивается.
 */
@Composable
private fun PhraseOfDayCard(phrase: PhraseOfDayPair) {
    val c = TeleTauTheme.colors
    TeleTauCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s100)) {
            KText("Фраза дня", TeleTauText.caption, color = c.textSecondary)
            FitText(
                phrase.textBa,
                TeleTauText.bashkir(TeleTauFontSize.headline, ru.teletau.core.designsystem.TeleTauFontWeight.black),
                color = c.textPrimary,
                maxLines = 3,
            )
            KText("«${phrase.sourceRu}»", TeleTauText.footnote, color = c.textSecondary, maxLines = 3)
        }
    }
}

/** Ссылка внутри строки текста: подчёркнутая, с целью нажатия по высоте строки кнопки. */
@Composable
private fun TextLink(text: String, onClick: () -> Unit) {
    val c = TeleTauTheme.colors
    Box(
        Modifier.defaultMinSize(minHeight = TeleTauSize.touchMin).clickable(role = Role.Button, onClick = onClick).padding(horizontal = TeleTauSpace.s100),
        contentAlignment = Alignment.Center,
    ) {
        KText(text, TeleTauText.footnote.copy(fontWeight = ru.teletau.core.designsystem.TeleTauFontWeight.bold, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline), color = c.accentText)
    }
}

/** Состояние входа по QR: ничего, «входим…» или ошибка. */
sealed interface ScanState {
    data object Idle : ScanState
    data object Pending : ScanState
    data class Error(val message: String) : ScanState
}

private sealed interface Camera {
    data object Off : Camera
    data object On : Camera
    data class Error(val message: String) : Camera
}

/**
 * Вход ученика (веб `/student`): сканер QR-карточки — камера или фото — и путь без карточки, по коду класса.
 * В QR — только полезная нагрузка `TT1.…` (ADR 0016); она уходит в теле запроса, не в адресе.
 */
@Composable
fun ScanScreen(state: ScanState, ended: String?, onScanned: (String) -> Unit, onNoCard: () -> Unit, onBack: () -> Unit, onReset: () -> Unit) {
    val context = LocalContext.current
    val c = TeleTauTheme.colors
    var camera by remember { mutableStateOf<Camera>(Camera.Off) }
    var photoError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val busy = state == ScanState.Pending
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        camera = if (granted) Camera.On else Camera.Error("Нет доступа к камере. Разреши его в настройках или загрузи фото карточки.")
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val text = withContext(Dispatchers.Default) {
                runCatching {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2400) sample *= 2
                    val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
                    bitmap?.let(QrDecoder::decode)
                }.getOrNull()
            }
            if (text == null) photoError = "QR-код не виден. Сфотографируй карточку ближе и ровнее."
            else onScanned(text)
        }
    }
    fun start() {
        onReset()
        photoError = null
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) camera = Camera.On
        else permission.launch(Manifest.permission.CAMERA)
    }
    Screen(top = { SimpleTopBar("Вход ученика", onBack = onBack) }) {
        Head("Покажи карточку камере", null)
        val shape = RoundedCornerShape(TeleTauRadius.card)
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f).clip(shape).background(c.bgSunken).border(TeleTauSpace.s050, c.borderSubtle, shape),
            contentAlignment = Alignment.Center,
        ) {
            if (camera == Camera.On && !busy) {
                QrCameraPreview(
                    onText = { text -> camera = Camera.Off; onScanned(text) },
                    onError = { camera = Camera.Error("Камера не включилась. Загрузи фото карточки.") },
                    modifier = Modifier.fillMaxSize().semantics { contentDescription = "Изображение с камеры" },
                )
                ScanCorners()
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
                    Image(PhosphorIcons.QrCodeBold, null, Modifier.size(96.dp), colorFilter = ColorFilter.tint(c.textTertiary))
                    TeleTauButton(if (busy) "Входим…" else "Сканировать карточку", ::start, icon = PhosphorIcons.CameraFill, loading = busy)
                }
            }
        }
        if (camera == Camera.On && !busy) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                KText("Держи карточку ровно", TeleTauText.footnote, color = c.textSecondary, align = TextAlign.Center)
                LinkButton("Выключить камеру", { camera = Camera.Off }, tone = LinkTone.Neutral, icon = PhosphorIcons.CameraSlashBold)
            }
        }
        val alerts = buildList {
            if (ended != null && state == ScanState.Idle) add(ended to AlertTone.Honey)
            if (state is ScanState.Error) add(state.message to AlertTone.Danger)
            (camera as? Camera.Error)?.let { add(it.message to AlertTone.Danger) }
            photoError?.let { add(it to AlertTone.Danger) }
        }
        if (alerts.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) { alerts.forEach { (t, tone) -> InlineAlert(t, tone = tone) } }
        // «Карточка найдена» — только для TalkBack: на кнопке уже «Входим…».
        if (busy) androidx.compose.foundation.layout.Box(Modifier.semantics { liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Polite; contentDescription = "Карточка найдена, входим" }) {}
        Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
            TeleTauButton("Загрузить фото", {
                onReset(); photoError = null; camera = Camera.Off
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary, icon = PhosphorIcons.ImageSquareFill, enabled = !busy)
            TeleTauButton("Ввести код класса", onNoCard, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary, icon = PhosphorIcons.KeyboardFill)
        }
    }
}

/** Уголки рамки поверх камеры. */
@Composable
private fun ScanCorners() {
    val c = TeleTauTheme.colors
    Canvas(Modifier.fillMaxSize().padding(TeleTauSpace.s800)) {
        val l = 36.dp.toPx()
        val w = 6.dp.toPx()
        val color = c.accentFill
        listOf(Offset(0f, 0f) to (1 to 1), Offset(size.width, 0f) to (-1 to 1), Offset(0f, size.height) to (1 to -1), Offset(size.width, size.height) to (-1 to -1)).forEach { (o, d) ->
            drawLine(color, o, Offset(o.x + l * d.first, o.y), w, StrokeCap.Round)
            drawLine(color, o, Offset(o.x, o.y + l * d.second), w, StrokeCap.Round)
        }
    }
}

/** Подсказки ника: три варианта из словаря, «Другие варианты». Свободного ввода нет (ADR 0009). */
@Composable
fun NicknamePicker(
    suggestions: Resource<List<NicknameSuggestion>>,
    picked: String?,
    onPick: (String) -> Unit,
    onMore: () -> Unit,
    submitLabel: String,
    submitting: Boolean,
    error: String?,
    onSubmit: () -> Unit,
) {
    val c = TeleTauTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
        when (suggestions) {
            Resource.Loading -> Column(Modifier.semantics(mergeDescendants = true) { contentDescription = "Подбираем ники" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
                repeat(3) { SkeletonBlock(height = 60.dp, radius = TeleTauRadius.button) }
            }
            is Resource.Failed -> {
                InlineAlert(describeForChild(suggestions.error), tone = AlertTone.Danger)
                TeleTauButton("Попробовать снова", onMore, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary, icon = PhosphorIcons.ArrowsClockwiseBold)
            }
            is Resource.Ready -> {
                Column(Modifier.semantics { contentDescription = "Варианты ника" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
                    suggestions.data.forEach { n ->
                        val on = n.id == picked
                        val shape = RoundedCornerShape(TeleTauRadius.button)
                        Row(
                            Modifier.fillMaxWidth().defaultMinSize(minHeight = TeleTauTheme.touchTarget)
                                .background(if (on) c.accentSoft else c.surface, shape)
                                .border(TeleTauSpace.s050, if (on) c.accentText else c.borderDefault, shape)
                                .clickable(role = Role.RadioButton) { onPick(n.id) }
                                .semantics { selected = on }
                                .padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s250),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
                        ) {
                            HexAvatar(36.dp, tone = toneFor(n.text), art = avatarFor(n.text))
                            KText(n.text, TeleTauText.bodyLarge.copy(fontWeight = ru.teletau.core.designsystem.TeleTauFontWeight.semibold), Modifier.weight(1f))
                        }
                    }
                }
                LinkButton("Другие варианты", onMore, icon = PhosphorIcons.ArrowsClockwiseBold, enabled = !submitting)
            }
        }
        if (error != null) InlineAlert(error, tone = AlertTone.Danger)
        TeleTauButton(submitLabel, onSubmit, Modifier.fillMaxWidth(), enabled = picked != null && suggestions is Resource.Ready, loading = submitting)
    }
}

/** Шаги входа по коду класса. */
enum class CodeStep { Code, Nick }

/**
 * Вход без карточки (веб `/student/code`, ADR 0016 §6): код класса с доски → ник из словаря → заявка учителю.
 * Системный «Назад» на шаге ника возвращает к коду.
 */
@Composable
fun ClassCodeScreen(
    step: CodeStep,
    code: String,
    codeError: String?,
    onCode: (String) -> Unit,
    onNext: () -> Unit,
    onBack: () -> Unit,
    picker: @Composable () -> Unit,
) {
    Screen(top = { SimpleTopBar("Вход по коду класса", onBack = onBack) }) {
        TeleTauProgressBar(if (step == CodeStep.Code) 1 else 2, 2, label = "Шаг входа", valueText = if (step == CodeStep.Code) "Шаг 1 из 2" else "Шаг 2 из 2")
        Head(
            if (step == CodeStep.Code) "Введи код класса" else "Выбери ник",
            if (step == CodeStep.Code) "Он на доске." else "По нему учитель узнает тебя.",
        )
        if (step == CodeStep.Code) {
            CodeCellsField(code, onCode, onNext, codeError)
            TeleTauButton("Дальше", onNext, Modifier.fillMaxWidth(), enabled = code.length >= 6)
        } else {
            picker()
        }
    }
}

/** Шесть ячеек кода (ABC-DEF): высота ≥ 56 dp, ширина 40–56 — шесть ячеек помещаются в 320 dp. */
@Composable
fun CodeCellsField(code: String, onCode: (String) -> Unit, onDone: () -> Unit, error: String?) {
    val c = TeleTauTheme.colors
    val focus = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
        BasicTextField(
            value = code,
            onValueChange = { raw -> onCode(Crockford.normalizeCodeInput(raw).take(6)) },
            singleLine = true,
            cursorBrush = SolidColor(androidx.compose.ui.graphics.Color.Transparent),
            textStyle = TeleTauText.title2.copy(color = androidx.compose.ui.graphics.Color.Transparent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { onDone() }, onDone = { onDone() }),
            modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = "Код класса" }
                .onFocusChanged { focused = it.isFocused },
            decorationBox = { inner ->
                BoxWithConstraints {
                    // Шесть ячеек и тире: ширина ячейки 40–56 dp по месту (в 320 dp — 40, на обычном телефоне — 52–56).
                    val cell = ((maxWidth - TeleTauSpace.s600 - TeleTauSpace.s150 * 6) / 6).coerceIn(40.dp, 56.dp)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                        for (i in 0 until 6) {
                            if (i == 3) KText("–", TeleTauText.title2, color = c.textTertiary)
                            val active = focused && (i == code.length || (code.length == 6 && i == 5))
                            val shape = RoundedCornerShape(TeleTauRadius.tile)
                            Box(
                                Modifier.size(cell, 60.dp)
                                    .background(c.surface, shape)
                                    .border(if (active) 3.dp else TeleTauSpace.s050, if (error != null) c.dangerText else if (active) c.focus else c.borderStrong, shape),
                                contentAlignment = Alignment.Center,
                            ) { KText(code.getOrNull(i)?.toString().orEmpty(), TeleTauText.title2) }
                        }
                    }
                    Box(Modifier.size(1.dp)) { inner() }
                }
            },
        )
        if (error != null) InlineAlert(error, tone = AlertTone.Danger)
    }
}

/** Состояние заявки по коду класса. */
sealed interface WaitState {
    data class Pending(val classTitle: String, val nickname: String, val offline: Boolean = false, val error: String? = null) : WaitState
    data object Rejected : WaitState
    data object Expired : WaitState
    data object Consumed : WaitState
    data object Missing : WaitState
    data class Closed(val title: String, val text: String) : WaitState
}

/** «Ждём, пока учитель подтвердит» (веб `/student/wait`): опрос заявки; одобрили — сессия и «Ты в классе». */
@Composable
fun WaitScreen(state: WaitState, onAgain: () -> Unit, onLeave: () -> Unit) {
    val again: @Composable ColumnScope.() -> Unit = { TeleTauButton("Ввести код", onAgain, Modifier.fillMaxWidth()) }
    Screen(top = { SimpleTopBar("Вход по коду класса") }) {
        when (state) {
            is WaitState.Closed -> EmptyState(R.drawable.bee_sympathy, state.title, text = state.text, alert = true) { TeleTauButton("Выйти", onLeave, Modifier.fillMaxWidth()) }
            WaitState.Missing -> EmptyState(R.drawable.bee_think, "Заявки нет", text = "Введи код класса заново.", actions = again)
            WaitState.Rejected -> EmptyState(R.drawable.bee_sympathy, "Учитель не принял заявку", text = "Подойди к учителю и попробуй ещё раз.", alert = true, actions = again)
            WaitState.Expired -> EmptyState(R.drawable.bee_sleep, "Заявка устарела", text = "Попроси учителя показать код ещё раз.", alert = true, actions = again)
            WaitState.Consumed -> EmptyState(R.drawable.bee_think, "Вход уже выполнен", text = "Если это был не ты, введи код заново.", actions = again)
            is WaitState.Pending -> {
                EmptyState(R.drawable.bee_idle, "Ждём учителя", richText = waitText(state.classTitle, state.nickname)) {
                    LinkButton("Выйти", onLeave, tone = LinkTone.Neutral, icon = PhosphorIcons.SignOutBold)
                }
                if (state.offline) InlineAlert("Нет связи. Заявка не потеряется.")
                state.error?.let { InlineAlert(it, tone = AlertTone.Danger) }
            }
        }
    }
}

/** Первый вход по карточке (веб `/student/nickname`): выбор ника; если карточка чужая — выйти, не выбирая ник. */
@Composable
fun NicknameScreen(leaving: Boolean, onLeave: () -> Unit, picker: @Composable () -> Unit) {
    Screen(top = { SimpleTopBar("Твой ник") }) {
        Head("Выбери ник", "Так тебя увидят в классе.")
        picker()
        LinkButton("Это не моя карточка", onLeave, Modifier.fillMaxWidth(), tone = LinkTone.Neutral, icon = PhosphorIcons.SignOutBold, enabled = !leaving)
    }
}

/** «Ты в классе 5 «Б»» (веб `/student/class`): итог первого входа; учитель видит ученика как «№07 · Смелая пчела». */
@Composable
fun JoinedScreen(me: Me, leaving: Boolean, onTrail: () -> Unit, onLeave: () -> Unit, onStay: () -> Unit, onLogout: () -> Unit) {
    val c = TeleTauTheme.colors
    val klass = studentClass(me)
    Screen(top = {
        SimpleTopBar("", end = { TeleTauIconButton(PhosphorIcons.SignOutBold, "Выйти", onLeave) })
    }) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
            Illustration(R.drawable.scene_class_hive, 200.dp, contentDescription = "Пчёлы класса летят к общей борти")
            KHeading(if (klass != null) "Ты в классе ${klass.title}" else "Вход выполнен", TeleTauText.title1, align = TextAlign.Center)
            if (klass != null) FitText(klass.schoolName, TeleTauText.bodyLarge, color = c.textSecondary, align = TextAlign.Center, maxLines = 3)
            TeleTauCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
                    HexAvatar(64.dp, tone = toneFor(me.nickname ?: me.id), art = avatarFor(me.nickname), lip = true)
                    Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                        KText(me.nickname ?: "Ник не выбран", TeleTauText.headline)
                        klass?.seatNumber?.let { TeleTauChip("Место №${it.toString().padStart(2, '0')}") }
                    }
                }
            }
            TeleTauButton("На тропу", onTrail, Modifier.fillMaxWidth().padding(top = TeleTauSpace.s300), icon = PhosphorIcons.PathFill)
        }
    }
    if (leaving) {
        TeleTauDialog("Уже уходишь?", onDismiss = onStay, description = "Войти снова можно по карточке или коду класса.", art = R.drawable.bee_sympathy) {
            TeleTauButton("Остаться", onStay, Modifier.fillMaxWidth())
            LinkButton("Выйти", onLogout, tone = LinkTone.Danger)
        }
    }
}

/** Состояние проверки адреса сервера. */
sealed interface HealthState {
    data object Idle : HealthState
    data object Checking : HealthState
    data object Ok : HealthState
    data class Failed(val message: String) : HealthState
}

/**
 * Адрес сервера для показа (debug): компьютер с API в той же сети Wi‑Fi, например `http://192.168.1.10:4000`.
 * Смена адреса завершает вход на этом устройстве: сессия принадлежит серверу.
 */
@Composable
fun SettingsScreen(
    current: String,
    currentWeb: String?,
    webPlaceholder: (String) -> String,
    health: HealthState,
    appVersion: String,
    onCheck: (String) -> Unit,
    onSave: (String, String) -> Unit,
    onBack: () -> Unit,
) {
    val c = TeleTauTheme.colors
    var value by remember(current) { mutableStateOf(current) }
    var web by remember(currentWeb) { mutableStateOf(currentWeb.orEmpty()) }
    Screen(top = { SimpleTopBar("Адрес сервера", onBack = onBack) }) {
        Head("Адрес сервера", "Адрес компьютера, на котором запущен API, в той же сети Wi‑Fi. Например, http://192.168.1.10:4000")
        UrlField(value, { value = it }, "Адрес сервера", null, onDone = { onSave(value, web) })
        KText("Адрес сайта — для записей «Послушать» и кабинета учителя. Пусто — тот же компьютер, порт 3000.", TeleTauText.callout, color = c.textSecondary)
        UrlField(web, { web = it }, "Адрес сайта", webPlaceholder(value), onDone = { onSave(value, web) })
        when (health) {
            HealthState.Ok -> InlineAlert("Связь есть — сервер отвечает.")
            is HealthState.Failed -> InlineAlert(health.message, tone = AlertTone.Danger)
            else -> Unit
        }
        Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
            TeleTauButton("Проверить связь", { onCheck(value) }, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary, icon = PhosphorIcons.WifiHighBold, loading = health == HealthState.Checking)
            TeleTauButton("Сохранить", { onSave(value, web) }, Modifier.fillMaxWidth(), enabled = value.isNotBlank())
        }
        KText("Версия приложения $appVersion", TeleTauText.footnote, color = c.textTertiary)
    }
}

@Composable
private fun UrlField(value: String, onChange: (String) -> Unit, label: String, placeholder: String?, onDone: () -> Unit) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.button)
    BasicTextField(
        value = value,
        onValueChange = { onChange(it.trim()) },
        singleLine = true,
        textStyle = TeleTauText.bodyLarge.copy(color = c.textPrimary),
        cursorBrush = SolidColor(c.focus),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        decorationBox = { inner ->
            Box(Modifier.fillMaxWidth().defaultMinSize(minHeight = TeleTauSize.touchChild).background(c.surface, shape).border(TeleTauSpace.s050, c.borderStrong, shape).padding(horizontal = TeleTauSpace.s400), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty() && placeholder != null) KText(placeholder, TeleTauText.bodyLarge, color = c.textTertiary)
                inner()
            }
        },
    )
}

/** «Класс 5 «Б». Скажи учителю свой ник: **«Смелая пчела»**.» — ник жирным: по нему учитель узнает ученика. */
fun waitText(classTitle: String, nickname: String): androidx.compose.ui.text.AnnotatedString = androidx.compose.ui.text.buildAnnotatedString {
    append("Класс $classTitle. Скажи учителю свой ник: ")
    pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = ru.teletau.core.designsystem.TeleTauFontWeight.bold))
    append("«$nickname»")
    pop()
    append(".")
}
