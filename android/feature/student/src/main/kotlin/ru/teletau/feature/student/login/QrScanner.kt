package ru.teletau.feature.student.login

import android.graphics.Bitmap
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Распознавание QR-карточки открытой ZXing (Apache 2.0) — без ML Kit и Google Play Services (CLAUDE.md, правило 12).
 * Кадры — CameraX ImageAnalysis (яркость Y), фото карточки — пиксели битмапа. Разбор и проверка полезной нагрузки —
 * `QrCardCodec` (общие векторы qr-card).
 */
object QrDecoder {
    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true,
    )

    fun decode(source: LuminanceSource): String? {
        val reader = MultiFormatReader().apply { setHints(hints) }
        for (s in listOf(source, source.invert())) {
            try {
                return reader.decodeWithState(BinaryBitmap(HybridBinarizer(s))).text
            } catch (_: Exception) {
                // не нашёлся — пробуем инверсию (QR светлым по тёмному)
            } finally {
                reader.reset()
            }
        }
        return null
    }

    /** Фото карточки: QR на фото бывает мелким — пробуем несколько масштабов, как веб (1600, 1000, 2400). */
    fun decode(bitmap: Bitmap): String? {
        for (side in listOf(1600, 1000, 2400)) {
            val scale = minOf(1f, side.toFloat() / maxOf(bitmap.width, bitmap.height))
            val b = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true) else bitmap
            val pixels = IntArray(b.width * b.height)
            b.getPixels(pixels, 0, b.width, 0, 0, b.width, b.height)
            decode(RGBLuminanceSource(b.width, b.height, pixels))?.let { return it }
            if (scale >= 1f) break
        }
        return null
    }

    fun decode(image: ImageProxy): String? {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val data = ByteArray(buffer.remaining())
        buffer.get(data)
        val source = PlanarYUVLuminanceSource(data, plane.rowStride, image.height, 0, 0, image.width, image.height, false)
        return decode(source)
    }
}

/**
 * Превью камеры с анализом кадров. Найден QR — [onText] (один раз, на главном потоке). Камера отпускается, когда
 * экран уходит из композиции.
 */
@Composable
fun QrCameraPreview(onText: (String) -> Unit, onError: (Throwable) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val latest = rememberUpdatedState(onText)
    val latestError = rememberUpdatedState(onError)
    val executor = remember { Executors.newSingleThreadExecutor() }
    val found = remember { AtomicBoolean(false) }
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(lifecycle) {
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        future.addListener({
            try {
                val p = future.get()
                provider = p
                val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { image ->
                    try {
                        if (!found.get()) {
                            QrDecoder.decode(image)?.let { text ->
                                if (found.compareAndSet(false, true)) ContextCompat.getMainExecutor(context).execute { latest.value(text) }
                            }
                        }
                    } finally {
                        image.close()
                    }
                }
                p.unbindAll()
                p.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (e: Exception) {
                latestError.value(e)
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            provider?.unbindAll()
            executor.shutdown()
        }
    }
    AndroidView(factory = { previewView }, modifier = modifier)
}
