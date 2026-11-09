package ru.teletau.app

import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.teletau.core.designsystem.TeleTauDarkColors
import ru.teletau.core.designsystem.TeleTauLightColors
import ru.teletau.feature.student.StudentApp
import ru.teletau.feature.student.StudentViewModel

class MainActivity : ComponentActivity() {
    private val vm: StudentViewModel by viewModels {
        viewModelFactory { initializer { StudentViewModel((application as TeleTauApplication).environment) } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // До первого кадра Compose окно светлое (Theme.TeleTau) — и значки панелей под светлый фон, даже в тёмной системе.
        val initial = barStyle(dark = false)
        enableEdgeToEdge(statusBarStyle = initial, navigationBarStyle = initial)
        super.onCreate(savedInstanceState)
        setContent {
            // «Убрать анимацию» в настройках телефона (масштаб анимаций 0) — экраны без декоративного движения.
            val reduceMotion = remember { Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
            // «Тёмная тема» из профиля; без выбора — светлая, системная тема не учитывается.
            val choice by vm.theme.choice.collectAsState()
            val dark = choice.isDark
            SystemBars(dark)
            StudentApp(vm, darkTheme = dark, reduceMotion = reduceMotion)
        }
    }

    /**
     * Строка состояния и панель навигации — в цвет темы приложения, а не системы: прозрачные (под ними фон экрана из
     * токенов), значки тёмные на светлой теме и светлые на тёмной. Фон окна — `bg` той же темы, чтобы при смене
     * раскладки (клавиатура, поворот) не мелькал фон системной темы.
     */
    @Composable
    private fun SystemBars(dark: Boolean) {
        DisposableEffect(dark) {
            val style = barStyle(dark)
            enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            window.setBackgroundDrawable(ColorDrawable((if (dark) TeleTauDarkColors else TeleTauLightColors).bg.toArgb()))
            onDispose {}
        }
    }

    /** Прозрачные панели: значки тёмные на светлой теме и светлые на тёмной, независимо от темы системы. */
    private fun barStyle(dark: Boolean): SystemBarStyle {
        val clear = Color.Transparent.toArgb()
        return if (dark) SystemBarStyle.dark(clear) else SystemBarStyle.light(clear, clear)
    }
}
