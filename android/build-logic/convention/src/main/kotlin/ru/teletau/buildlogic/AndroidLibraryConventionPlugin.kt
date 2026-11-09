package ru.teletau.buildlogic

import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/** `teletau.android.library` — Android-библиотека без Compose (сеть, БД, синхронизация). */
public class AndroidLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project): Unit = with(target) {
        pluginManager.apply("com.android.library")
        extensions.configure<LibraryExtension> {
            configureAndroid(this)
            // У библиотеки нет собственного targetSdk; эти значения — для unit-тестов (Robolectric) и lint.
            testOptions.targetSdk { version = release(TeleTauSdk.TARGET) }
            lint.targetSdk { version = release(TeleTauSdk.TARGET) }
        }
    }
}
