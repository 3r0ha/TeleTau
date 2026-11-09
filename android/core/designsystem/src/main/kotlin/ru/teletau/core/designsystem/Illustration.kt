package ru.teletau.core.designsystem

import android.content.res.Resources
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp

/**
 * Картинки утверждённой серии (design/assets/approved → `R.drawable.*`). Ничего не рисуется кодом «на глаз»
 * (docs/05 §0, правило 2). Картинка декодируется сразу в нужном размере (`inSampleSize`) и кешируется:
 * тропа показывает десятки декораций, полноразмерные битмапы съели бы память слабого телефона.
 */
public object Illustrations {
    private val sizes = HashMap<Int, Pair<Int, Int>>()
    private val cache = object : LruCache<String, ImageBitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
    }

    /** Ширина и высота исходника в пикселях. */
    @Synchronized
    public fun size(resources: Resources, @DrawableRes id: Int): Pair<Int, Int> = sizes.getOrPut(id) {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeResource(resources, id, o)
        (o.outWidth.coerceAtLeast(1)) to (o.outHeight.coerceAtLeast(1))
    }

    /** Битмап не меньше [targetWidthPx] по ширине (степень двойки уменьшения). */
    @Synchronized
    public fun bitmap(resources: Resources, @DrawableRes id: Int, targetWidthPx: Int): ImageBitmap {
        val (w, _) = size(resources, id)
        var sample = 1
        while (w / (sample * 2) >= targetWidthPx.coerceAtLeast(1)) sample *= 2
        val key = "$id@$sample"
        cache.get(key)?.let { return it }
        val o = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = requireNotNull(BitmapFactory.decodeResource(resources, id, o)) { "Картинка $id не декодируется" }.asImageBitmap()
        cache.put(key, bitmap)
        return bitmap
    }
}

/** Отношение ширины картинки к высоте. */
@Composable
public fun illustrationAspect(@DrawableRes id: Int): Float {
    val resources = LocalResources.current
    return remember(id) { Illustrations.size(resources, id).let { (w, h) -> w.toFloat() / h } }
}

/** Картинка серии шириной [width] с сохранением пропорций. Без [contentDescription] — декоративная. */
@Composable
public fun Illustration(@DrawableRes id: Int, width: Dp, modifier: Modifier = Modifier, contentDescription: String? = null) {
    val resources = LocalResources.current
    val px = with(LocalDensity.current) { width.roundToPx() }
    val bitmap = remember(id, px) { Illustrations.bitmap(resources, id, px) }
    Image(
        bitmap = bitmap,
        contentDescription = null,
        modifier = modifier
            .width(width)
            .aspectRatio(bitmap.width.toFloat() / bitmap.height)
            .then(if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier),
        contentScale = ContentScale.Fit,
    )
}

/** Картинка, заполняющая отведённое место с обрезкой (герой карточки экспедиции, вывеска места). */
@Composable
public fun IllustrationFill(@DrawableRes id: Int, targetWidth: Dp, modifier: Modifier = Modifier, alignment: androidx.compose.ui.Alignment = androidx.compose.ui.Alignment.Center) {
    val resources = LocalResources.current
    val px = with(LocalDensity.current) { targetWidth.roundToPx() }
    val bitmap = remember(id, px) { Illustrations.bitmap(resources, id, px) }
    Image(bitmap = bitmap, contentDescription = null, modifier = modifier, contentScale = ContentScale.Crop, alignment = alignment)
}
