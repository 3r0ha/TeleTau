package ru.teletau.app

import android.app.Application

/** Приложение «ТелеТау»: одно окружение на процесс (клиент API, сессия, настройки). Сторонних SDK нет (правило 12). */
class TeleTauApplication : Application() {
    val environment: AppEnvironment by lazy { AppEnvironment(this) }
}
