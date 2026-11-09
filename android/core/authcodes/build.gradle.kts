plugins {
    alias(libs.plugins.teletau.jvm.library)
}

dependencies {
    // Только разбор JSON векторов: без плагина сериализации, через Json.parseToJsonElement.
    testImplementation(libs.kotlinx.serialization.json)
}

// Общие тест-векторы лежат вне android/ (contracts/test-vectors) — их же проходит эталон TS (@teletau/auth-codes).
val repoRoot: String = rootDir.parentFile.absolutePath

tasks.test {
    systemProperty("teletau.repoRoot", repoRoot)
    inputs.dir("$repoRoot/contracts/test-vectors/qr-card")
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("qrCardVectors")
    inputs.dir("$repoRoot/contracts/test-vectors/login-card")
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("loginCardVectors")
    inputs.dir("$repoRoot/contracts/test-vectors/class-code")
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("classCodeVectors")
}
