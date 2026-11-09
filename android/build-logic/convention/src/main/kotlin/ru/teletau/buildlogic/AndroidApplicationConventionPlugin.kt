package ru.teletau.buildlogic

import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/**
 * `teletau.android.application` — Android-приложение на Compose.
 * Kotlin встроен в AGP 9 (плагин org.jetbrains.kotlin.android не нужен).
 */
public class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project): Unit = with(target) {
        pluginManager.apply("com.android.application")
        extensions.configure<ApplicationExtension> {
            configureAndroid(this)
            defaultConfig.targetSdk { version = release(TeleTauSdk.TARGET) }
            configureCompose(this)
        }
    }
}
