plugins {
    alias(libs.plugins.teletau.jvm.library)
}

dependencies {
    // Только разбор JSON векторов: без плагина сериализации, через Json.parseToJsonElement.
    testImplementation(libs.kotlinx.serialization.json)
}

// Общие тест-векторы лежат вне android/ (contracts/test-vectors) — их же проходят TS и Swift.
val repoRoot: String = rootDir.parentFile.absolutePath

tasks.test {
    systemProperty("teletau.repoRoot", repoRoot)
    inputs.dir("$repoRoot/contracts/test-vectors/bashkir-text")
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("bashkirTextVectors")
}
