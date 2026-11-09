package ru.teletau.core.designsystem

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em

/**
 * Шрифты платформы (docs/05 §4): Nunito — заголовки, цифры, кнопки и весь башкирский текст (у Nunito есть `locl BSH`:
 * башкирские формы Ҫ и Ҙ); Golos Text — основной русский текст. Файлы — вариативные TTF из packages/design-tokens/fonts,
 * у Nunito вес по умолчанию 200, поэтому каждый вес задаётся осью `wght` явно.
 */
public object TeleTauFonts {
    private fun variable(resId: Int, weight: FontWeight): Font =
        Font(resId, weight = weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))

    private val weights = listOf(
        TeleTauFontWeight.regular, TeleTauFontWeight.medium, TeleTauFontWeight.semibold,
        TeleTauFontWeight.bold, TeleTauFontWeight.extrabold, TeleTauFontWeight.black,
    )

    /** [TeleTauFontFamilyName.DISPLAY] */
    public val display: FontFamily = FontFamily(weights.map { variable(R.font.nunito, it) })

    /** [TeleTauFontFamilyName.TEXT] */
    public val text: FontFamily = FontFamily(weights.map { variable(R.font.golos_text, it) })
}

/** Башкирский: с этой локалью шейпер включает `locl BSH` и выбирает башкирские начертания Ҫ и Ҙ. */
public val BashkirLocale: LocaleList = LocaleList("ba")

/** Стили текста «Борть» — размеры и веса только из токенов. */
public object TeleTauText {
    private fun display(size: TextUnit, weight: FontWeight, lineHeight: Float = TeleTauLineHeight.SNUG): TextStyle =
        TextStyle(fontFamily = TeleTauFonts.display, fontSize = size, fontWeight = weight, lineHeight = (lineHeight).em)

    private fun text(size: TextUnit, weight: FontWeight = TeleTauFontWeight.regular): TextStyle =
        TextStyle(fontFamily = TeleTauFonts.text, fontSize = size, fontWeight = weight, lineHeight = TeleTauLineHeight.BODY.em)

    public val display: TextStyle = display(TeleTauFontSize.display, TeleTauFontWeight.black, TeleTauLineHeight.TIGHT)
    public val title1: TextStyle = display(TeleTauFontSize.title1, TeleTauFontWeight.black, TeleTauLineHeight.TIGHT)
    public val title2: TextStyle = display(TeleTauFontSize.title2, TeleTauFontWeight.black)
    public val title3: TextStyle = display(TeleTauFontSize.title3, TeleTauFontWeight.black, TeleTauLineHeight.TIGHT)
    public val headline: TextStyle = display(TeleTauFontSize.headline, TeleTauFontWeight.black)
    public val button: TextStyle = display(TeleTauFontSize.button, TeleTauFontWeight.extrabold, TeleTauLineHeight.TIGHT)
    public val label: TextStyle = display(TeleTauFontSize.label, TeleTauFontWeight.extrabold, TeleTauLineHeight.TIGHT)
    public val caption: TextStyle = display(TeleTauFontSize.caption, TeleTauFontWeight.extrabold, TeleTauLineHeight.TIGHT)

    public val bodyLarge: TextStyle = text(TeleTauFontSize.bodyLarge)
    public val body: TextStyle = text(TeleTauFontSize.body)
    public val callout: TextStyle = text(TeleTauFontSize.callout)
    public val footnote: TextStyle = text(TeleTauFontSize.footnote)
    public val labelText: TextStyle = text(TeleTauFontSize.label)

    /**
     * Башкирский текст из API: Nunito с локалью `ba` (формы Ҫ и Ҙ). Учебный текст — не мельче `fontSize.bodyLarge`
     * (в «Пчёлке» шрифты и так крупнее в 1,125 раза).
     */
    public fun bashkir(size: TextUnit = TeleTauFontSize.bodyLarge, weight: FontWeight = TeleTauFontWeight.bold): TextStyle =
        TextStyle(fontFamily = TeleTauFonts.display, fontSize = size, fontWeight = weight, lineHeight = TeleTauLineHeight.SNUG.em, localeList = BashkirLocale)
}
