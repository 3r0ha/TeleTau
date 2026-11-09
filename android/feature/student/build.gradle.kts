plugins {
    alias(libs.plugins.teletau.android.library.compose)
    alias(libs.plugins.roborazzi)
}

android {
    namespace = "ru.teletau.feature.student"
}

dependencies {
    api(projects.core.designsystem)
    api(projects.core.session)
    implementation(projects.core.authcodes)

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)
    // Сканер QR-карточки: кадры CameraX → ZXing (без ML Kit и Google Play Services, CLAUDE.md, правило 12)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.zxing.core)

    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.androidx.compose.ui.test.manifest)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.ktor.client.mock)
}

// Эталоны снимков экранов — в репозитории (src/test/snapshots), сверка — verifyRoborazziDebug.
roborazzi {
    outputDir.set(layout.projectDirectory.dir("src/test/snapshots"))
}

tasks.withType<Test>().configureEach {
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
    // Снимки длинных экранов (тропа целиком) — большие битмапы.
    maxHeapSize = "3g"
}
