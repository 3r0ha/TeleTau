package ru.teletau.feature.student

import android.graphics.BitmapFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.teletau.core.authcodes.LoginCardCodec
import ru.teletau.core.authcodes.LoginCardKind
import ru.teletau.core.authcodes.LoginCardParseResult
import ru.teletau.feature.student.common.renderCardPng
import ru.teletau.feature.student.login.QrDecoder
import ru.teletau.feature.student.preview.Demo

/** «Сохранить картинку»: PNG 1080 × 1350, QR на ней читается сканером приложения обратно в ту же карточку `TP1`. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class CardImageTest {
    @Test
    fun savedCard_qrRoundTrips() {
        val png = renderCardPng(RuntimeEnvironment.getApplication(), Demo.loginCard.payload, 1, "Мудрая сова", "ТелеТау", "teletau.study")
        val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size)
        assertEquals(1080, bitmap.width)
        assertEquals(1350, bitmap.height)
        val text = QrDecoder.decode(bitmap)
        val parsed = LoginCardCodec.parse(text.orEmpty()) as LoginCardParseResult.Ok
        assertEquals(LoginCardKind.PERSONAL, parsed.card.kind)
        assertEquals(Demo.loginCard.payload, parsed.card.payload)
    }
}
