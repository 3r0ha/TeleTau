import org.jetbrains.kotlin.gradle.dsl.ExplicitApiMode
import org.openapitools.generator.gradle.plugin.tasks.GenerateTask

/*
 * Клиент API — только генерируется из packages/contracts/openapi.yaml (CLAUDE.md, правило 1; docs/06 §6.1):
 * openapi-generator, генератор `kotlin`, kotlinx.serialization + Ktor. Ручных DTO нет, сгенерированное не правится
 * и не хранится в репозитории — его пересобирает каждая сборка (build/generated/openapi).
 *
 * Два прогона одного генератора:
 * 1. Модели — шаблоны `jvm-retrofit2` с `generateOneOfAnyOfWrappers`: только они дают для `oneOf`
 *    (`RunExercise`, `AttemptAnswer`) запечатанный интерфейс с сериализатором по полю `type`. Шаблоны `jvm-ktor`
 *    (проверено на 7.27, в том числе с `discriminator` у `AttemptAnswer`) делают `sealed class` со всеми
 *    полями всех вариантов, а варианты (`TilesAnswer`…) от него не наследуются — такой ответ на сервер не отправить.
 * 2. Операции и инфраструктура — шаблоны `jvm-ktor` (клиент Ktor, suspend-функции на каждую операцию).
 *
 * Обходы ограничений генератора (контракт не меняется):
 * - `RESOLVE_INLINE_ENUMS`: встроенные перечисления — отдельными типами (`TilesAnswerType`, `RunKind`…), а не
 *   вложенными `Type` с одинаковыми именами.
 * - `number → Double` (точность, множитель мёда), `UUID → String`, `URI → String`, даты — строками: без контекстных сериализаторов java.util.UUID / java.net.URI / java.time.
 */
plugins {
    alias(libs.plugins.teletau.jvm.library)
    alias(libs.plugins.kotlin.serialization)
}

val contract: File = rootDir.parentFile.resolve("packages/contracts/openapi.yaml")
val pkg = "ru.teletau.core.network"

val commonConfig = mapOf(
    "serializationLibrary" to "kotlinx_serialization",
    "dateLibrary" to "string",
    "enumPropertyNaming" to "camelCase",
    "explicitApi" to "true",
    "sourceFolder" to "src/main/kotlin",
)

fun GenerateTask.common(out: String) {
    generatorName.set("kotlin")
    inputSpec.set(contract.absolutePath)
    outputDir.set(layout.buildDirectory.dir(out))
    packageName.set(pkg)
    apiPackage.set("$pkg.apis")
    modelPackage.set("$pkg.models")
    // Свободный объект (AuditEntry.metadata) — JsonElement: у kotlin.Any нет сериализатора.
    typeMappings.set(mapOf("UUID" to "kotlin.String", "URI" to "kotlin.String", "number" to "kotlin.Double", "AnyType" to "JsonElement"))
    importMappings.set(mapOf("JsonElement" to "kotlinx.serialization.json.JsonElement"))
    inlineSchemaOptions.set(mapOf("RESOLVE_INLINE_ENUMS" to "true"))
    cleanupOutput.set(true)
    // Предупреждение «OpenAPI 3.1 support is still in beta» — не ошибка; спецификацию проверяет redocly в pnpm contracts:check.
    validateSpec.set(false)
    generateApiTests.set(false)
    generateModelTests.set(false)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
}

val generateModels = tasks.register<GenerateTask>("openApiGenerateModels") {
    description = "Модели API из packages/contracts/openapi.yaml"
    common("generated/openapi/models")
    library.set("jvm-retrofit2")
    configOptions.set(commonConfig + mapOf("generateOneOfAnyOfWrappers" to "true"))
    globalProperties.set(mapOf("models" to ""))
}

val generateClient = tasks.register<GenerateTask>("openApiGenerateClient") {
    description = "Операции API (Ktor) из packages/contracts/openapi.yaml"
    common("generated/openapi/client")
    library.set("jvm-ktor")
    configOptions.set(commonConfig)
    globalProperties.set(
        mapOf(
            "apis" to "",
            "supportingFiles" to listOf(
                "ApiClient.kt", "ApiAbstractions.kt", "HttpResponse.kt", "RequestConfig.kt", "RequestMethod.kt",
                "Authentication.kt", "HttpBearerAuth.kt", "HttpBasicAuth.kt", "ApiKeyAuth.kt", "OAuth.kt",
            ).joinToString(","),
        ),
    )
}

sourceSets {
    main {
        kotlin.srcDir(generateModels.flatMap { it.outputDir.dir("src/main/kotlin") })
        kotlin.srcDir(generateClient.flatMap { it.outputDir.dir("src/main/kotlin") })
    }
}

kotlin {
    // Сгенерированный код соблюдает explicit API (опция explicitApi генератора), но в шаблоне обёрток oneOf
    // у свойства value нет модификатора — строгий режим здесь выключен (только для этого модуля).
    explicitApi = ExplicitApiMode.Disabled
    compilerOptions {
        // Сгенерированный код: предупреждения о лишних квалификаторах и неиспользуемых импортах не наши.
        suppressWarnings.set(true)
    }
}

dependencies {
    api(libs.ktor.client.core)
    api(libs.ktor.client.content.negotiation)
    api(libs.ktor.serialization.kotlinx.json)
    api(libs.kotlinx.serialization.json)

    testImplementation(libs.ktor.client.mock)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test {
    systemProperty("teletau.repoRoot", rootDir.parentFile.absolutePath)
}
