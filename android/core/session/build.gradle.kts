plugins {
    alias(libs.plugins.teletau.jvm.library)
}

dependencies {
    api(projects.core.network)
    api(libs.kotlinx.coroutines.core)

    testImplementation(libs.ktor.client.mock)
    testImplementation(libs.kotlinx.coroutines.test)
}
