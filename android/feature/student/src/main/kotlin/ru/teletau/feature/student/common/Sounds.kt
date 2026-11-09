package ru.teletau.feature.student.common

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.tanh

/** Звуки интерфейса ученика (docs/05 §9) — те же, что на сайте (`apps/web/.../learn/sound.ts`). */
enum class UiSound { Tap, Correct, Almost, Wrong, Voted, NewWord, Complete, Streak, LevelUp }

/** Звуки интерфейса: выключатель «Звуки» в профиле (настройка устройства) и «сыграть». */
interface UiSounds {
    val enabled: StateFlow<Boolean>
    fun setEnabled(on: Boolean)
    fun play(sound: UiSound)
}

/** Без звука: превью, снимки экранов и тесты. */
object SilentSounds : UiSounds {
    private val off = MutableStateFlow(false)
    override val enabled: StateFlow<Boolean> = off.asStateFlow()
    override fun setEnabled(on: Boolean) = Unit
    override fun play(sound: UiSound) = Unit
}

val LocalUiSounds = staticCompositionLocalOf<UiSounds> { SilentSounds }

/** Сыграть звук экрана один раз, когда экран появился. */
@Composable
fun ScreenSound(sound: UiSound) {
    val sounds = LocalUiSounds.current
    LaunchedEffect(sound) { sounds.play(sound) }
}

/**
 * Синтез звуков без файлов: короткие ноты с огибающей (атака 12 мс, экспоненциальное затухание), синус или треугольник,
 * тихий обертон октавой выше («деревянный» тембр, ближе к кураю) и срез высоких для глухого «неверно».
 * Чистая функция — проверяется тестом.
 */
object SoundSynth {
    const val SAMPLE_RATE = 44_100

    private enum class Wave { Sine, Triangle }

    private class Note(
        val f: Double,
        val at: Double,
        val dur: Double,
        val gain: Double,
        val wave: Wave = Wave.Sine,
        val to: Double? = null,
        val overtone: Double = 0.0,
        val lowpass: Double? = null,
    )

    private const val C5 = 523.25
    private const val E5 = 659.25
    private const val G5 = 783.99
    private const val A5 = 880.0
    private const val B5 = 987.77
    private const val C6 = 1046.5
    private const val D6 = 1174.66
    private const val E6 = 1318.51
    private const val G4 = 392.0

    private val NOTES: Map<UiSound, List<Note>> = mapOf(
        // Касание плитки: короткий «пузырёк».
        UiSound.Tap to listOf(Note(620.0, 0.0, 0.07, 0.07, to = 380.0)),
        // Верно: две восходящие ноты.
        UiSound.Correct to listOf(Note(E5, 0.0, 0.14, 0.16, overtone = 0.25), Note(B5, 0.09, 0.34, 0.16, overtone = 0.25)),
        // Почти: ответ засчитан — мягче и короче, чем «верно».
        UiSound.Almost to listOf(Note(E5, 0.0, 0.14, 0.13, overtone = 0.2), Note(G5, 0.1, 0.3, 0.13, overtone = 0.2)),
        // Неверно: два глухих низких тона вниз — без резкого «зуммера».
        UiSound.Wrong to listOf(
            Note(233.08, 0.0, 0.16, 0.2, Wave.Triangle, lowpass = 900.0),
            Note(185.0, 0.13, 0.3, 0.2, Wave.Triangle, lowpass = 700.0),
        ),
        // Голос учтён: колокольчик двумя нотами сразу.
        UiSound.Voted to listOf(Note(C6, 0.0, 0.42, 0.09), Note(E6, 0.03, 0.42, 0.07)),
        // Новое слово: мягкий колокольчик снизу вверх — тише «Голос учтён», без обертонов: знакомство, а не оценка.
        UiSound.NewWord to listOf(Note(G5, 0.0, 0.24, 0.06), Note(C6, 0.09, 0.42, 0.05)),
        // Урок пройден: арпеджио и аккорд.
        UiSound.Complete to listOf(
            Note(C5, 0.0, 0.16, 0.13, overtone = 0.2), Note(E5, 0.11, 0.16, 0.13, overtone = 0.2),
            Note(G5, 0.22, 0.16, 0.13, overtone = 0.2), Note(C6, 0.33, 0.7, 0.14, overtone = 0.2),
            Note(G5, 0.33, 0.7, 0.06), Note(E5, 0.33, 0.7, 0.05),
        ),
        // Серия: тёплый подъём.
        UiSound.Streak to listOf(
            Note(G4, 0.0, 0.18, 0.12, overtone = 0.25), Note(C5, 0.12, 0.18, 0.12, overtone = 0.25),
            Note(E5, 0.24, 0.6, 0.13, overtone = 0.25), Note(G5, 0.24, 0.6, 0.07),
        ),
        // Новая лига: короткие фанфары.
        UiSound.LevelUp to listOf(
            Note(G5, 0.0, 0.12, 0.12, overtone = 0.25), Note(G5, 0.13, 0.12, 0.12, overtone = 0.25),
            Note(C6, 0.26, 0.2, 0.13, overtone = 0.25), Note(A5, 0.46, 0.12, 0.11, overtone = 0.25),
            Note(D6, 0.58, 0.18, 0.12, overtone = 0.25), Note(E6, 0.76, 0.8, 0.12, overtone = 0.2),
            Note(C6, 0.76, 0.8, 0.06),
        ),
    )

    /** Громкость выхода: на телефоне ноты сайта звучат тише, поэтому чуть громче и с мягким ограничением пиков. */
    private const val OUT = 1.8

    /** 16-битный моно PCM звука. */
    fun render(sound: UiSound, rate: Int = SAMPLE_RATE): ShortArray {
        val notes = NOTES.getValue(sound)
        val total = notes.maxOf { it.at + it.dur } + 0.03
        val mix = DoubleArray((total * rate).toInt())
        for (n in notes) voice(n, mix, rate)
        return ShortArray(mix.size) { i -> (tanh(mix[i] * OUT) * Short.MAX_VALUE).toInt().toShort() }
    }

    /** Длительность звука, мс. */
    fun durationMs(sound: UiSound): Long = (NOTES.getValue(sound).maxOf { it.at + it.dur } * 1000).toLong() + 30

    private fun voice(n: Note, out: DoubleArray, rate: Int) {
        val start = (n.at * rate).toInt()
        val len = (n.dur * rate).toInt()
        val attack = 0.012 * rate
        // Экспоненциальное затухание от пика до 0.0001 к концу ноты.
        val k = ln(0.0001) / (len - attack).coerceAtLeast(1.0)
        val filter = n.lowpass?.let { Biquad.lowpass(it, rate) }
        var phase = 0.0
        var phase2 = 0.0
        for (i in 0 until len) {
            val idx = start + i
            if (idx >= out.size) break
            val t = i.toDouble() / len
            val f = if (n.to != null) n.f * Math.pow(n.to / n.f, t) else n.f
            phase += 2 * PI * f / rate
            phase2 += 2 * PI * f * 2 / rate
            var s = wave(n.wave, phase)
            if (n.overtone > 0) s += sin(phase2) * n.overtone
            if (filter != null) s = filter.next(s)
            val env = if (i < attack) n.gain * i / attack else n.gain * exp(k * (i - attack))
            out[idx] += s * env
        }
    }

    private fun wave(w: Wave, phase: Double): Double = when (w) {
        Wave.Sine -> sin(phase)
        Wave.Triangle -> {
            val x = (phase / (2 * PI)) % 1.0
            1 - 4 * abs(x - 0.5)
        }
    }

    /** Фильтр нижних частот второго порядка (RBJ, Q = 0.707) — как BiquadFilterNode «lowpass». */
    private class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0

        fun next(x: Double): Double {
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y
        }

        companion object {
            fun lowpass(freq: Double, rate: Int): Biquad {
                val w = 2 * PI * min(freq, rate / 2.0 - 1) / rate
                val alpha = sin(w) / (2 * 0.7071)
                val cw = cos(w)
                val a0 = 1 + alpha
                return Biquad((1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, -2 * cw / a0, (1 - alpha) / a0)
            }
        }
    }
}

/**
 * Звуки на AudioTrack (без файлов и сторонних SDK, CLAUDE.md, правило 12). Молчат, если ученик выключил «Звуки», если
 * телефон в беззвучном режиме или на вибрации и пока звучит запись носителя («Послушать» важнее).
 * Звук готовится и играет в своём потоке — экран не ждёт.
 */
class SynthSounds(
    context: Context,
    initial: Boolean,
    private val save: (Boolean) -> Unit,
    private val speaking: () -> Boolean,
) : UiSounds {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "teletau-sounds").apply { isDaemon = true } }
    private val cache = HashMap<UiSound, ShortArray>()
    private var track: AudioTrack? = null
    private val _enabled = MutableStateFlow(initial)
    override val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    override fun setEnabled(on: Boolean) {
        _enabled.value = on
        save(on)
        if (!on) worker.execute { release() }
    }

    override fun play(sound: UiSound) {
        if (!_enabled.value || speaking() || audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) return
        worker.execute {
            runCatching {
                val pcm = cache.getOrPut(sound) { SoundSynth.render(sound) }
                release()
                val t = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                    )
                    .setAudioFormat(
                        AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(SoundSynth.SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                    )
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setBufferSizeInBytes(pcm.size * 2)
                    .build()
                t.write(pcm, 0, pcm.size)
                t.play()
                track = t
            }
        }
    }

    private fun release() {
        track?.let { runCatching { it.stop(); it.release() } }
        track = null
    }
}
