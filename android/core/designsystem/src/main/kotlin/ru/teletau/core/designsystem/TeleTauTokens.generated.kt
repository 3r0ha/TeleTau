// СГЕНЕРИРОВАНО из packages/design-tokens/tokens (W3C DTCG). Не редактировать вручную.
// Перегенерация: pnpm --filter @teletau/design-tokens build

package ru.teletau.core.designsystem

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Семантические цвета «Борть». */
@Immutable
public data class TeleTauColors(
    /** Фон экрана */
    public val bg: Color,
    /** Крем: фон вокруг колонки на широком экране, утопленные области */
    public val bgSunken: Color,
    /** Карточки, листы, поля ввода */
    public val surface: Color,
    /** Шоколадный текст */
    public val textPrimary: Color,
    public val textSecondary: Color,
    /** Подписи, кикеры, неактивные вкладки */
    public val textTertiary: Color,
    /** Текст на ярких заливках (мёд, зелень, вода, коралл) — тёмный в обеих темах (шоколадный в светлой, графитовый в тёмной): белый на них не проходит AA */
    public val textOnFill: Color,
    /** Мёд: главная кнопка, прогресс, пройденные ячейки. Не для текста */
    public val accentFill: Color,
    /** Глубокий мёд: «губа» медовой кнопки и ячейки */
    public val accentLip: Color,
    /** Текст-акцент мёда, ссылки */
    public val accentText: Color,
    /** Текст на медовой заливке */
    public val accentOn: Color,
    /** Медовая подложка: чипы, выбранная строка, активная вкладка */
    public val accentSoft: Color,
    /** Граница медовой подложки */
    public val accentSoftBorder: Color,
    /** Зелень: «верно», успех */
    public val successFill: Color,
    public val successLip: Color,
    public val successText: Color,
    public val successSoft: Color,
    /** Вода (Агидель): информация, задания учителя */
    public val infoFill: Color,
    public val infoLip: Color,
    public val infoText: Color,
    public val infoSoft: Color,
    /** Коралл: ошибка, опасное действие (всегда с иконкой или текстом, не только цветом) */
    public val dangerFill: Color,
    public val dangerLip: Color,
    public val dangerText: Color,
    public val dangerSoft: Color,
    /** Фиолетовая кнопка («Помоги языку»). Единственная заливка с белым текстом */
    public val violetFill: Color,
    public val violetLip: Color,
    public val violetText: Color,
    public val violetSoft: Color,
    /** Яркий фиолетовый для узлов и иконок (не для текста) */
    public val violetBright: Color,
    /** Текст на фиолетовой заливке */
    public val violetOn: Color,
    /** Огонь серии (прототип v2): иконка пламени, крупное число дней на экране серии, ячейки дней. Не для мелкого текста (≥ 3:1 — только иконки и крупный текст) */
    public val streakFill: Color,
    /** «Губа» огненной ячейки и кнопки */
    public val streakLip: Color,
    /** Текст серии обычного размера: счётчик в шапке, «6 дней подряд» (≥ 4.5:1) */
    public val streakText: Color,
    /** Подложка серии: чип, ячейка дня с заморозкой рядом */
    public val streakSoft: Color,
    /** Воск: закрытое, недоступное */
    public val lockedFill: Color,
    public val lockedLip: Color,
    /** Текст недоступного элемента (WCAG не требует контраста для неактивных) */
    public val lockedText: Color,
    /** Декоративные границы карточек и разделители */
    public val borderSubtle: Color,
    /** Границы плиток и вторичных кнопок, их «губа» */
    public val borderDefault: Color,
    /** Границы полей ввода и контролов (≥ 3:1, WCAG 1.4.11) */
    public val borderStrong: Color,
    /** Кольцо фокуса клавиатуры (≥ 3:1) */
    public val focus: Color,
    /** Затемнение под листом и диалогом (с прозрачностью в компоненте) */
    public val scrim: Color,
    /** Блик на ярких заливках (прогресс, ячейки) — с прозрачностью в компоненте */
    public val highlight: Color,
    /** Подложка места: Уфа */
    public val zoneHoney: Color,
    /** Подложка места: Шульган-Таш */
    public val zoneGreen: Color,
    /** Подложка места: Агидель */
    public val zoneWater: Color,
)

public val TeleTauLightColors: TeleTauColors = TeleTauColors(
    bg = Color(0xFFFFFCF5),
    bgSunken = Color(0xFFFFF8EC),
    surface = Color(0xFFFFFFFF),
    textPrimary = Color(0xFF3B2716),
    textSecondary = Color(0xFF6F5B47),
    textTertiary = Color(0xFF85705B),
    textOnFill = Color(0xFF3B2716),
    accentFill = Color(0xFFFFB703),
    accentLip = Color(0xFFE39400),
    accentText = Color(0xFF8A5200),
    accentOn = Color(0xFF3B2716),
    accentSoft = Color(0xFFFFF3D1),
    accentSoftBorder = Color(0xFFFFD979),
    successFill = Color(0xFF43C35E),
    successLip = Color(0xFF2C9C45),
    successText = Color(0xFF1E7A33),
    successSoft = Color(0xFFE7F8EA),
    infoFill = Color(0xFF1CA7F2),
    infoLip = Color(0xFF0B87CB),
    infoText = Color(0xFF0A6597),
    infoSoft = Color(0xFFE4F4FE),
    dangerFill = Color(0xFFFF5A5A),
    dangerLip = Color(0xFFE03B3B),
    dangerText = Color(0xFFB3261E),
    dangerSoft = Color(0xFFFFECEA),
    violetFill = Color(0xFF7B3CE6),
    violetLip = Color(0xFF5E26C0),
    violetText = Color(0xFF6B2ED6),
    violetSoft = Color(0xFFF2EBFF),
    violetBright = Color(0xFF9B5CFF),
    violetOn = Color(0xFFFFFFFF),
    streakFill = Color(0xFFE8590C),
    streakLip = Color(0xFFC2470A),
    streakText = Color(0xFFB23F07),
    streakSoft = Color(0xFFFFEDE2),
    lockedFill = Color(0xFFECE5D9),
    lockedLip = Color(0xFFD6CCBC),
    lockedText = Color(0xFFA99D8B),
    borderSubtle = Color(0xFFF0E6D4),
    borderDefault = Color(0xFFE2D4BC),
    borderStrong = Color(0xFFA08A72),
    focus = Color(0xFF0B87CB),
    scrim = Color(0xFF3B2716),
    highlight = Color(0xFFFFFFFF),
    zoneHoney = Color(0xFFFFF5DC),
    zoneGreen = Color(0xFFEDF6E7),
    zoneWater = Color(0xFFE8F4FB),
)

public val TeleTauDarkColors: TeleTauColors = TeleTauColors(
    bg = Color(0xFF131F24),
    bgSunken = Color(0xFF0D171B),
    surface = Color(0xFF1C2B32),
    textPrimary = Color(0xFFF1F7FB),
    textSecondary = Color(0xFFC6D3DA),
    textTertiary = Color(0xFF95A8B2),
    textOnFill = Color(0xFF131F24),
    accentFill = Color(0xFFFFB703),
    accentLip = Color(0xFFB87400),
    accentText = Color(0xFFFFC94D),
    accentOn = Color(0xFF131F24),
    accentSoft = Color(0xFF2F2A14),
    accentSoftBorder = Color(0xFF5E4E1A),
    successFill = Color(0xFF43C35E),
    successLip = Color(0xFF26843A),
    successText = Color(0xFF74DB8B),
    successSoft = Color(0xFF183A2B),
    infoFill = Color(0xFF1CA7F2),
    infoLip = Color(0xFF0A73AD),
    infoText = Color(0xFF6CC8FF),
    infoSoft = Color(0xFF133A4E),
    dangerFill = Color(0xFFFF6464),
    dangerLip = Color(0xFFC93636),
    dangerText = Color(0xFFFF8F86),
    dangerSoft = Color(0xFF44242A),
    violetFill = Color(0xFF7B3CE6),
    violetLip = Color(0xFF5420B0),
    violetText = Color(0xFFC7A6FF),
    violetSoft = Color(0xFF2E2753),
    violetBright = Color(0xFFA673FF),
    violetOn = Color(0xFFFFFFFF),
    streakFill = Color(0xFFFF7A2F),
    streakLip = Color(0xFFC2500F),
    streakText = Color(0xFFFFA36B),
    streakSoft = Color(0xFF40271A),
    lockedFill = Color(0xFF2E3D45),
    lockedLip = Color(0xFF222F36),
    lockedText = Color(0xFF7F929C),
    borderSubtle = Color(0xFF2A3A42),
    borderDefault = Color(0xFF37464F),
    borderStrong = Color(0xFF6D818B),
    focus = Color(0xFF6CC8FF),
    scrim = Color(0xFF000000),
    highlight = Color(0xFFFFFFFF),
    zoneHoney = Color(0xFF23251F),
    zoneGreen = Color(0xFF15292A),
    zoneWater = Color(0xFF132A35),
)

public object TeleTauSpace {
    public val s050: Dp = 2.dp
    public val s100: Dp = 4.dp
    public val s150: Dp = 6.dp
    public val s200: Dp = 8.dp
    public val s250: Dp = 10.dp
    public val s300: Dp = 12.dp
    public val s350: Dp = 14.dp
    public val s400: Dp = 16.dp
    public val s450: Dp = 18.dp
    public val s500: Dp = 20.dp
    public val s600: Dp = 24.dp
    public val s800: Dp = 32.dp
    public val s1000: Dp = 40.dp
    public val s1200: Dp = 48.dp
    public val s1600: Dp = 64.dp
}

public object TeleTauRadius {
    public val small: Dp = 8.dp
    public val mark: Dp = 9.dp
    public val brand: Dp = 10.dp
    public val iconButton: Dp = 12.dp
    public val tile: Dp = 14.dp
    public val button: Dp = 16.dp
    public val panel: Dp = 20.dp
    public val card: Dp = 24.dp
    public val sheet: Dp = 28.dp
    public val chip: Dp = 999.dp
}

public object TeleTauSize {
    /** Минимальная цель нажатия (режимы «Бортник», «Хранитель»; на Android Compose сам расширяет область нажатия до 48 dp) */
    public val touchMin: Dp = 44.dp
    /** Цель нажатия в режиме «Пчёлка» (1–4 класс): в вебе заменяет touchMin и высоту кнопки */
    public val touchChild: Dp = 56.dp
    /** Высота кнопки действия */
    public val button: Dp = 52.dp
    /** «Губа» кнопки: нижняя кромка глубокого цвета, при нажатии кнопка опускается на неё */
    public val lip: Dp = 4.dp
    /** «Губа» плитки и варианта ответа */
    public val lipSmall: Dp = 3.dp
    /** Толщина кольца фокуса */
    public val focusRing: Dp = 3.dp
    /** Высота прогресс-бара */
    public val progress: Dp = 14.dp
    public val iconSmall: Dp = 20.dp
    public val icon: Dp = 24.dp
    public val iconLarge: Dp = 28.dp
    /** Колонка экранов ученика и входа на широком экране */
    public val columnNarrow: Dp = 480.dp
    /** Колонка кабинета учителя и консоли */
    public val columnWide: Dp = 1120.dp
}

public object TeleTauFontSize {
    public val caption: TextUnit = 12.sp
    /** Чипы, кикеры, подписи вкладок */
    public val label: TextUnit = 13.sp
    public val footnote: TextUnit = 14.sp
    public val callout: TextUnit = 15.sp
    public val body: TextUnit = 16.sp
    /** Надпись кнопки (Nunito) */
    public val button: TextUnit = 17.sp
    /** Минимум для учебного башкирского текста */
    public val bodyLarge: TextUnit = 18.sp
    /** Заголовок карточки */
    public val headline: TextUnit = 19.sp
    /** Заголовок листа и диалога; учебный башкирский текст в режиме «Пчёлка» */
    public val title3: TextUnit = 22.sp
    /** Заголовок страницы */
    public val title2: TextUnit = 26.sp
    /** Заголовок полноэкранного состояния */
    public val title1: TextUnit = 30.sp
    /** Название на заставке */
    public val display: TextUnit = 44.sp
    /** Код класса на доске — читается с последней парты */
    public val board: TextUnit = 88.sp
}

public object TeleTauFontFamilyName {
    /** Текст. Полное покрытие башкирских букв (research/02 §F4) */
    public const val TEXT: String = "Golos Text"
    /** Заголовки, цифры, кнопки, режим «Пчёлка». locl BSH. У вариативного файла вес по умолчанию 200 — вес задаётся явно */
    public const val DISPLAY: String = "Nunito"
}

/** Начертания. У вариативного Nunito вес по умолчанию 200 — вес задаётся явно. */
public object TeleTauFontWeight {
    public val regular: FontWeight = FontWeight(400)
    public val medium: FontWeight = FontWeight(500)
    public val semibold: FontWeight = FontWeight(600)
    public val bold: FontWeight = FontWeight(700)
    /** Кнопки, чипы, подписи (Nunito) */
    public val extrabold: FontWeight = FontWeight(800)
    /** Заголовки и цифры (Nunito) */
    public val black: FontWeight = FontWeight(900)
}

/** Межстрочный интервал — множитель размера шрифта. */
public object TeleTauLineHeight {
    /** Крупные заголовки */
    public const val TIGHT: Float = 1.1f
    public const val SNUG: Float = 1.25f
    /** Основной текст */
    public const val BODY: Float = 1.45f
}

/** Длительности анимаций в миллисекундах. */
public object TeleTauDuration {
    /** Нажатие кнопки на «губу» */
    public const val PRESS: Int = 80
    public const val FAST: Int = 120
    public const val BASE: Int = 200
    public const val SLOW: Int = 400
    /** Оборот индикатора «идёт действие» на кнопке */
    public const val SPIN: Int = 900
    /** Проход блика по скелетону загрузки */
    public const val SHIMMER: Int = 1400
    /** Парение пчелы на заставке (цикл) */
    public const val DRIFT: Int = 2400
    /** Шаг задержки: звенья сот серии загораются по очереди */
    public const val STAGGER: Int = 110
    /** Кадр «глаза закрыты» при моргании пчелы */
    public const val BLINK: Int = 150
    /** Смена кадра крыльев, когда пчела трепещет крыльями */
    public const val FLAP: Int = 110
    /** Короткое покачивание при неверном ответе */
    public const val SHAKE: Int = 420
    /** Вспышка и капли мёда при верном ответе */
    public const val BURST: Int = 720
    /** Появление с подъёмом: значок лиги, звено серии, баннер */
    public const val RISE: Int = 700
    /** Прыжок пчелы со сжатием на итоге урока */
    public const val HOP: Int = 900
    /** Счётчик мёда «набегает» на итоге урока */
    public const val COUNT: Int = 1000
    /** Тропинка дорисовывается до текущего узла */
    public const val DRAW: Int = 1100
    /** Блик проходит по значку лиги */
    public const val GLINT: Int = 1100
    /** Мерцание огня серии (цикл) */
    public const val FLICKER: Int = 1500
    /** Подпрыгивание пузыря «Начать» (цикл) */
    public const val BOB: Int = 1600
    /** «Дыхание» кольца текущего узла тропы (цикл) */
    public const val BREATH: Int = 2000
    /** Падение конфетти из маленьких сот */
    public const val CONFETTI: Int = 2200
    /** Пчела плавает вверх-вниз (цикл) */
    public const val FLOAT: Int = 3000
    /** Пауза между морганиями: от одной до двух таких пауз (3–6 с) */
    public const val BLINK_GAP: Int = 3000
    /** Лодка качается на волне (цикл) */
    public const val ROCK: Int = 3200
    /** Декорации тропы покачиваются от основания (цикл) */
    public const val SWAY: Int = 3600
    /** Рыба выпрыгивает из воды — прыжок и пауза (цикл) */
    public const val LEAP: Int = 5200
    /** Трамвай чуть катается туда-сюда (цикл) */
    public const val ROLL: Int = 6000
}

/** Кривые анимаций. */
public object TeleTauEasing {
    /** Появление листов, диалогов, тостов */
    public val out: Easing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
    /** Плавные циклы: покачивание, парение, дыхание */
    public val inOut: Easing = CubicBezierEasing(0.45f, 0f, 0.55f, 1f)
    /** Пружина с перелётом: прыжок, подъём значка, пузырь */
    public val spring: Easing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
    /** Падение с ускорением: капли мёда, конфетти */
    public val fall: Easing = CubicBezierEasing(0.55f, 0f, 1f, 0.45f)
}
