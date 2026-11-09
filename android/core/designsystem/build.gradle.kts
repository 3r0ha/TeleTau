plugins {
    alias(libs.plugins.teletau.android.library.compose)
    alias(libs.plugins.roborazzi)
}

android {
    namespace = "ru.teletau.core.designsystem"
}

/*
 * Картинки и шрифты — без копий в android/: единственный источник — design/assets/approved (утверждённая серия,
 * docs/15-art-brief.md §0) и packages/design-tokens/fonts (полные шрифты с locl BSH, проверены fonts.test.ts).
 * Задача кладёт их в сгенерированный каталог ресурсов варианта: `place-ufa-hero.webp` → `R.drawable.place_ufa_hero`
 * (drawable-nodpi: размер задаёт экран в dp), шрифты — `R.font.nunito`, `R.font.golos_text`.
 */
abstract class SyncDesignAssets : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NAME_ONLY)
    abstract val images: ConfigurableFileCollection

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val nunito: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val golosText: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun sync() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        val drawable = File(out, "drawable-nodpi").apply { mkdirs() }
        images.files.sortedBy { it.name }.forEach { f ->
            val name = f.name.replace('-', '_')
            require(Regex("^[a-z][a-z0-9_]*\\.webp$").matches(name)) { "Имя картинки не годится для ресурса Android: ${f.name}" }
            f.copyTo(File(drawable, name), overwrite = true)
        }
        val font = File(out, "font").apply { mkdirs() }
        nunito.get().asFile.copyTo(File(font, "nunito.ttf"), overwrite = true)
        golosText.get().asFile.copyTo(File(font, "golos_text.ttf"), overwrite = true)
    }
}

val repoRoot: File = rootDir.parentFile
val syncDesignAssets = tasks.register<SyncDesignAssets>("syncDesignAssets") {
    description = "Картинки design/assets/approved и шрифты packages/design-tokens/fonts → ресурсы Android"
    images.from(fileTree(repoRoot.resolve("design/assets/approved")) { include("*.webp"); exclude("tg-bot-cover.webp") })
    nunito.set(repoRoot.resolve("packages/design-tokens/fonts/nunito/Nunito-VariableFont_wght.ttf"))
    golosText.set(repoRoot.resolve("packages/design-tokens/fonts/golos-text/GolosText-VariableFont_wght.ttf"))
    outputDir.set(layout.buildDirectory.dir("generated/teletau/res"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.res?.addGeneratedSourceDirectory(syncDesignAssets, SyncDesignAssets::outputDir)
    }
}

dependencies {
    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    // ComponentActivity для createComposeRule() в Robolectric-тестах (в манифест тестов, не в AAR).
    testImplementation(libs.androidx.compose.ui.test.manifest)
}

// Эталонные снапшоты хранятся в репозитории; плагин учитывает каталог как вход тестов,
// поэтому изменение эталона перезапускает сверку. Отчёты и *_compare.png — в build/.
roborazzi {
    outputDir.set(layout.projectDirectory.dir("src/test/snapshots"))
}

tasks.withType<Test>().configureEach {
    // Robolectric для SDK 36 обращается к jdk.internal.access (FileDescriptor) — без этого падает на JDK 21.
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
}
