package ru.teletau.feature.student.common

/** Данные экрана: загрузка, данные (возможно, устаревшие — пока идёт обновление) или ошибка. */
sealed interface Resource<out T> {
    data object Loading : Resource<Nothing>
    data class Ready<T>(val data: T, val refreshing: Boolean = false) : Resource<T>
    data class Failed(val error: Throwable) : Resource<Nothing>
}

val <T> Resource<T>.data: T? get() = (this as? Resource.Ready<T>)?.data
