package ru.teletau.core.designsystem

import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp

/** Цвета текущей темы «Борть». По умолчанию — светлые (для превью вне [TeleTauTheme]). */
public val LocalTeleTauColors: ProvidableCompositionLocal<TeleTauColors> =
    staticCompositionLocalOf { TeleTauLightColors }

/**
 * Возрастной режим интерфейса (docs/05 §7, контракт `Me.uiMode`): «Пчёлка» 1–4 класс, «Бортник» 5–8, «Хранитель» 9–11.
 * До входа ученика — «Пчёлка»: возраст ещё неизвестен, а крупные цели подходят всем (как в вебе).
 */
public enum class UiMode { Bee, Bortnik, Keeper }

public val LocalUiMode: ProvidableCompositionLocal<UiMode> = staticCompositionLocalOf { UiMode.Bortnik }

/**
 * Системная настройка «Убрать анимацию» (масштаб анимаций 0): декоративное движение не запускается, экран сразу
 * в итоговом кадре. Снимки экранов делаются в этом режиме.
 */
public val LocalReduceMotion: ProvidableCompositionLocal<Boolean> = staticCompositionLocalOf { false }

/** Тёмная ли палитра внутри [TeleTauTheme]. */
public val LocalDarkTheme: ProvidableCompositionLocal<Boolean> = staticCompositionLocalOf { false }

/**
 * Выбор темы на устройстве (выключатель «Тёмная тема» в профиле). Пока не выбирали — [Light]: системная тема
 * не учитывается.
 */
public enum class ThemeChoice {
    Light, Dark;

    /** Тёмная ли палитра. */
    public val isDark: Boolean get() = this == Dark

    public companion object {
        /** Выбор выключателем «Тёмная тема». */
        public fun of(dark: Boolean): ThemeChoice = if (dark) Dark else Light
    }
}

/**
 * Режим «Пчёлка»: все размеры шрифтов крупнее в 1,125 раза — токен `fontScale.bee` (packages/design-tokens/tokens/base),
 * в Kotlin-выход токенов он не выводится, поэтому значение повторено здесь.
 */
internal const val BEE_FONT_SCALE: Float = 1.125f

/**
 * Тема «Борть»: светлая или тёмная («Графит») палитра из дизайн-токенов, возрастной режим и «Убрать анимацию».
 *
 * @param darkTheme по умолчанию светлая, системная тема не учитывается; приложение передаёт [ThemeChoice.isDark]
 *   выбора на устройстве, превью и снапшоты — явное значение.
 */
@Composable
public fun TeleTauTheme(
    darkTheme: Boolean = false,
    uiMode: UiMode = UiMode.Bortnik,
    reduceMotion: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) TeleTauDarkColors else TeleTauLightColors
    val density = LocalDensity.current
    val scaled = if (uiMode == UiMode.Bee) Density(density.density, density.fontScale * BEE_FONT_SCALE) else density
    CompositionLocalProvider(
        LocalTeleTauColors provides colors,
        LocalUiMode provides uiMode,
        LocalReduceMotion provides reduceMotion,
        LocalDarkTheme provides darkTheme,
        LocalDensity provides scaled,
        LocalTextSelectionColors provides TextSelectionColors(handleColor = colors.focus, backgroundColor = colors.accentSoftBorder),
        content = content,
    )
}

/** Доступ к значениям темы внутри [TeleTauTheme]: `TeleTauTheme.colors.bg`. */
public object TeleTauTheme {
    public val colors: TeleTauColors
        @Composable
        @ReadOnlyComposable
        get() = LocalTeleTauColors.current

    public val uiMode: UiMode
        @Composable
        @ReadOnlyComposable
        get() = LocalUiMode.current

    public val reduceMotion: Boolean
        @Composable
        @ReadOnlyComposable
        get() = LocalReduceMotion.current

    /** Тёмная палитра: положение выключателя «Тёмная тема» — то, что сейчас на экране. */
    public val isDark: Boolean
        @Composable
        @ReadOnlyComposable
        get() = LocalDarkTheme.current

    /** Минимальная цель нажатия: 56 dp в «Пчёлке» (`size.touchChild`), иначе 44 dp (`size.touchMin`). */
    public val touchTarget: Dp
        @Composable
        @ReadOnlyComposable
        get() = if (LocalUiMode.current == UiMode.Bee) TeleTauSize.touchChild else TeleTauSize.touchMin

    /** Высота кнопки действия: в «Пчёлке» — 56 dp, иначе `size.button`. */
    public val buttonHeight: Dp
        @Composable
        @ReadOnlyComposable
        get() = if (LocalUiMode.current == UiMode.Bee) TeleTauSize.touchChild else TeleTauSize.button
}
