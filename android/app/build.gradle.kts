plugins {
    alias(libs.plugins.teletau.android.application)
}

android {
    namespace = "ru.teletau.app"

    defaultConfig {
        applicationId = "ru.teletau.app"
        versionCode = 2
        versionName = "0.2.0-m2"
        // Адрес API по умолчанию — компьютер-хозяин эмулятора; на телефоне адрес задаётся экраном «Адрес сервера»
        // или при сборке для демо: ./gradlew :app:assembleDebug -Pteletau.apiUrl=http://<IP компьютера>:4000
        val apiUrl = (project.findProperty("teletau.apiUrl") as String?) ?: "http://10.0.2.2:4000"
        buildConfigField("String", "DEFAULT_API_URL", "\"$apiUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            buildConfigField("String", "DEFAULT_API_URL", "\"https://api.teletau.study\"")
        }
    }
}

/*
 * Значок приложения — из утверждённой серии (design/assets/approved/app-icon.webp), без копии в android/.
 */
abstract class SyncLauncherIcon : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val icon: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun sync() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        icon.get().asFile.copyTo(File(out, "mipmap-xxxhdpi/ic_launcher.webp"), overwrite = true)
    }
}

val syncLauncherIcon = tasks.register<SyncLauncherIcon>("syncLauncherIcon") {
    icon.set(rootDir.parentFile.resolve("design/assets/approved/app-icon.webp"))
    outputDir.set(layout.buildDirectory.dir("generated/teletau/res"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.res?.addGeneratedSourceDirectory(syncLauncherIcon, SyncLauncherIcon::outputDir)
    }
}

dependencies {
    implementation(projects.feature.student)
    implementation(projects.core.designsystem)
    implementation(projects.core.session)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.ktor.client.okhttp)
}
