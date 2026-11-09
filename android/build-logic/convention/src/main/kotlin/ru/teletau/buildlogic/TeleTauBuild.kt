package ru.teletau.buildlogic

import com.android.build.api.dsl.CommonExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.api.artifacts.MinimalExternalModuleDependency
import org.gradle.api.artifacts.dsl.DependencyHandler
import org.gradle.api.provider.Provider
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.getByType
import org.gradle.kotlin.dsl.withType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinBaseExtension
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

/** Версии Android SDK — одно место для всех модулей. */
internal object TeleTauSdk {
    /**
     * Compose BOM 2026.09.00 (Compose UI 1.12) требует compileSdk ≥ 37 (minCompileSdk в AAR-метаданных),
     * поэтому платформа android-37.2 (AGP скачивает её сам), а не установленная 36.1. targetSdk — 36.
     */
    const val COMPILE = 37
    const val COMPILE_MINOR = 2
    const val MIN = 26
    const val TARGET = 36
}

/** JDK, которым компилируем и запускаем тесты (toolchain, при отсутствии — автозагрузка через foojay). */
internal const val JDK_TOOLCHAIN = 21

/** Версия байткода: модули :core:* потребляются Android-приложением (minSdk 26, D8). */
internal val JAVA_TARGET: JavaVersion = JavaVersion.VERSION_17
internal val KOTLIN_JVM_TARGET: JvmTarget = JvmTarget.JVM_17

internal val Project.libs: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

internal fun VersionCatalog.lib(alias: String): Provider<MinimalExternalModuleDependency> =
    findLibrary(alias).orElseThrow { IllegalArgumentException("В libs.versions.toml нет библиотеки $alias") }

internal fun <T : Any> DependencyHandler.implementation(dep: Provider<T>) = addProvider("implementation", dep)
internal fun <T : Any> DependencyHandler.debugImplementation(dep: Provider<T>) = addProvider("debugImplementation", dep)
internal fun <T : Any> DependencyHandler.testImplementation(dep: Provider<T>) = addProvider("testImplementation", dep)
internal fun <T : Any> DependencyHandler.testRuntimeOnly(dep: Provider<T>) = addProvider("testRuntimeOnly", dep)

/** Общее для приложений и библиотек Android. */
internal fun Project.configureAndroid(android: CommonExtension) {
    android.compileSdk {
        version = release(TeleTauSdk.COMPILE) { minorApiLevel = TeleTauSdk.COMPILE_MINOR }
    }
    android.defaultConfig.minSdk { version = release(TeleTauSdk.MIN) }
    android.compileOptions.sourceCompatibility = JAVA_TARGET
    android.compileOptions.targetCompatibility = JAVA_TARGET
    configureKotlin()
}

/**
 * Kotlin: toolchain JDK 21, байткод 17. В модулях `:core:*` — explicit API
 * (CLAUDE.md, «Соглашения»): публичный API ядра объявляется явно.
 */
internal fun Project.configureKotlin() {
    extensions.configure<KotlinBaseExtension> {
        jvmToolchain(JDK_TOOLCHAIN)
        if (path.startsWith(":core:")) explicitApi()
    }
    tasks.withType<KotlinJvmCompile>().configureEach {
        compilerOptions.jvmTarget.set(KOTLIN_JVM_TARGET)
    }
}

/** Compose: компилятор Compose (плагин Kotlin) + BOM и базовые артефакты. */
internal fun Project.configureCompose(android: CommonExtension) {
    pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
    android.buildFeatures.compose = true
    // AGP 9.5 регистрирует для каждого Compose-варианта задачу generate<Variant>ComposePreviewRunfiles,
    // которой нужны unit-тесты варианта с Android-ресурсами; без этого падает даже `./gradlew tasks`.
    // Unit-тесты release включены свойством android.onlyEnableUnitTestForTheTestedBuildType=false.
    android.testOptions.unitTests.isIncludeAndroidResources = true
    dependencies.apply {
        val bom = dependencies.platform(libs.lib("androidx-compose-bom"))
        implementation(bom)
        testImplementation(bom)
        implementation(libs.lib("androidx-compose-ui"))
        implementation(libs.lib("androidx-compose-foundation"))
        implementation(libs.lib("androidx-compose-ui-tooling-preview"))
        debugImplementation(libs.lib("androidx-compose-ui-tooling"))
    }
}
