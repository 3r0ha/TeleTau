package ru.teletau.buildlogic

import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/** `teletau.android.library.compose` — Android-библиотека с Compose (дизайн-система, фичи). */
public class AndroidLibraryComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project): Unit = with(target) {
        pluginManager.apply("teletau.android.library")
        extensions.configure<LibraryExtension> {
            configureCompose(this)
        }
    }
}
