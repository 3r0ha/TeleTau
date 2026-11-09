package ru.teletau.feature.student.common

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.res.ResourcesCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import ru.teletau.core.designsystem.TeleTauLightColors
import ru.teletau.core.designsystem.R
import java.io.ByteArrayOutputStream

/** Тихая зона вокруг QR — 4 модуля (ISO/IEC 18004). */
const val QR_QUIET: Int = 4

/**
 * Модули QR личной карточки (ZXing, уровень коррекции M — как в вебе). В коде — только полезная нагрузка `TP1.…`,
 * без ссылки (ADR 0016 §2, ADR 0022): системная камера не откроет браузер с секретом.
 */
fun qrModules(payload: String): BitMatrix =
    QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 0))

/**
 * Картинка карточки для сохранения (PNG 1080 × 1350, как в вебе): бренд, «Карточка входа», ник, QR и шаги входа.
 * Цвета — светлая тема токенов (печать и фото экрана), шрифты — Nunito и Golos Text приложения.
 * «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1).
 */
fun renderCardPng(context: Context, payload: String, version: Int, nickname: String, brand: String, host: String): ByteArray {
    val w = 1080
    val h = 1350
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val c = TeleTauLightColors
    val display = ResourcesCompat.getFont(context, R.font.nunito) ?: Typeface.DEFAULT_BOLD
    val text = ResourcesCompat.getFont(context, R.font.golos_text) ?: Typeface.DEFAULT
    fun paint(color: androidx.compose.ui.graphics.Color, face: Typeface? = null, size: Float = 0f, weight: Int = 400) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color.toArgb()
        if (face != null) {
            typeface = face
            textSize = size
            textAlign = Paint.Align.CENTER
            fontVariationSettings = "'wght' $weight"
        }
    }
    canvas.drawColor(c.bgSunken.toArgb())
    canvas.drawRoundRect(RectF(60f, 76f, w - 60f, h - 60f), 56f, 56f, paint(c.accentLip))
    canvas.drawRoundRect(RectF(60f, 60f, w - 60f, h - 76f), 56f, 56f, paint(c.surface))
    canvas.drawText(brand, w / 2f, 190f, paint(c.textPrimary, display, 84f, 900).apply { textLocale = java.util.Locale.forLanguageTag("ba") })
    canvas.drawText("Карточка входа", w / 2f, 250f, paint(c.textSecondary, text, 38f, 600))
    canvas.drawText(nickname, w / 2f, 330f, paint(c.textPrimary, display, 52f, 900))
    val m = qrModules(payload)
    val side = 600f
    val cell = side / (m.width + QR_QUIET * 2)
    val qx = (w - side) / 2
    val qy = 380f
    canvas.drawRect(qx, qy, qx + side, qy + side, paint(c.highlight))
    val dark = paint(c.textOnFill)
    for (y in 0 until m.height) for (x in 0 until m.width) {
        if (m[x, y]) canvas.drawRect(qx + (x + QR_QUIET) * cell, qy + (y + QR_QUIET) * cell, qx + (x + QR_QUIET + 1) * cell + 0.5f, qy + (y + QR_QUIET + 1) * cell + 0.5f, dark)
    }
    val steps = paint(c.textSecondary, text, 34f, 600)
    listOf("1. Открой $host", "2. «Я ученик» → «Сканировать карточку»", "3. Наведи камеру на этот код").forEachIndexed { i, line ->
        canvas.drawText(line, w / 2f, 1065f + i * 52f, steps)
    }
    canvas.drawText("Выпуск $version · не показывай карточку чужим", w / 2f, 1230f, paint(c.textSecondary, text, 28f, 600))
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    bitmap.recycle()
    return out.toByteArray()
}

/** Имя файла картинки: «teletau-karta-1.png». */
fun cardFileName(version: Int): String = "teletau-karta-$version.png"

/** Android 10+: в галерею (Pictures/TeleTau) без разрешений. Возвращает false, если не вышло. */
fun saveToGallery(context: Context, png: ByteArray, name: String): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    return runCatching {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/TeleTau")
        }
        val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
        context.contentResolver.openOutputStream(uri)?.use { it.write(png) } ?: return false
        true
    }.getOrDefault(false)
}

/** Android 8–9: в файл, который выбрал ученик (системный диалог «Сохранить»). */
fun writeTo(context: Context, uri: Uri, png: ByteArray): Boolean =
    runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(png) } != null }.getOrDefault(false)
