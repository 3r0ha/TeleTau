package ru.teletau.feature.student.common

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import ru.teletau.core.designsystem.SpeakButton
import ru.teletau.core.designsystem.SpeakSize
import ru.teletau.core.network.models.AudioClip

/** Воспроизведение записей носителя: что сейчас звучит (адрес) и «сыграть». */
interface Speaker {
    val playing: StateFlow<String?>
    fun play(url: String)
    fun stop()
}

/** Проигрыватель приложения. В превью и снимках его нет — кнопка рисуется, но не звучит. */
val LocalSpeaker = staticCompositionLocalOf<Speaker?> { null }

/** Адрес сайта (веба): от него отсчитываются относительные адреса записей (`/audio/…`). */
val LocalWebBase = staticCompositionLocalOf<String?> { null }

/**
 * Адрес записи из контракта (`AudioClip.url`) — как есть: абсолютный (`https://…`) играется напрямую, относительный
 * (`/audio/<id>.m4a` на сайте) — от адреса веба. Адреса веба нет — относительную запись сыграть негде, кнопки нет.
 */
fun resolveAudioUrl(url: String?, webBase: String?): String? {
    val u = url?.trim().orEmpty()
    if (u.isEmpty()) return null
    if (u.startsWith("http://") || u.startsWith("https://")) return u
    val base = webBase?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() } ?: return null
    return if (u.startsWith("/")) base + u else "$base/$u"
}

/** «Послушать» — только там, где запись есть. */
@Composable
fun Listen(clip: AudioClip?, modifier: Modifier = Modifier, size: SpeakSize = SpeakSize.Large, label: String = "Послушать") {
    val url = resolveAudioUrl(clip?.url, LocalWebBase.current) ?: return
    val speaker = LocalSpeaker.current
    val playing = speaker?.playing?.collectAsState()?.value
    SpeakButton(playing == url, { speaker?.play(url) }, modifier, size, label)
}

/**
 * Проигрыватель на системном MediaPlayer (Ogg Vorbis, AAC, WAV — без сторонних SDK, CLAUDE.md, правило 12).
 * Одна запись за раз: новое нажатие останавливает прежнюю. Не загрузилась — просто тишина.
 */
class MediaSpeaker(private val context: Context) : Speaker {
    private val _playing = MutableStateFlow<String?>(null)
    override val playing: StateFlow<String?> = _playing.asStateFlow()
    private var player: MediaPlayer? = null

    override fun play(url: String) {
        stop()
        val p = MediaPlayer()
        player = p
        _playing.value = url
        try {
            p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            p.setDataSource(context, Uri.parse(url))
            p.setOnPreparedListener { if (player === it) it.start() }
            p.setOnCompletionListener { if (player === it) stop() }
            p.setOnErrorListener { mp, _, _ -> if (player === mp) stop(); true }
            p.prepareAsync()
        } catch (_: Exception) {
            stop()
        }
    }

    override fun stop() {
        player?.let { runCatching { it.reset(); it.release() } }
        player = null
        _playing.value = null
    }
}
