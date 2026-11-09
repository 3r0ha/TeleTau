package ru.teletau.feature.student.learn

import androidx.annotation.DrawableRes
import ru.teletau.core.designsystem.R

/*
 * Оформление мест экспедиции на тропе (docs/05 §0, решения 2–3) — порт apps/web/app/_components/learn/places.ts:
 * подложка места, вывеска, герой карточки экспедиции и декорации. Декорации — композиция, а не сетка: крупный «якорь»,
 * уходящий за край, рядом мелочь в другом масштабе и зеркально — на стороне, противоположной изгибу тропы.
 * Координаты — из утверждённого прототипа: x — от оси тропы, y — от верха дорожки юнита, w — ширина, dp.
 */

enum class PlaceTone { Honey, Green, Water }

/** Движение декорации: покачивание от основания, трамвай катается, лодка качается, рыба выпрыгивает. */
enum class DecoMotion { Sway, Roll, Rock, Leap }

data class Deco(@param:DrawableRes val art: Int, val x: Float, val y: Float, val w: Float, val flip: Boolean = false, val rot: Float = 0f, val motion: DecoMotion? = null)

data class PlaceArt(
    val tone: PlaceTone,
    @param:DrawableRes val hero: Int? = null,
    @param:DrawableRes val sign: Int? = null,
    /** Текст вывески светлый (на зелёной вывеске Шульган-Таша). */
    val signOnDark: Boolean = false,
    /** Доля ширины вывески слева, где нет рисунка (ровный фон над орнаментом), — там стоит надпись. */
    val signCalm: Float = 0.49f,
    val heroAlt: String? = null,
    val decos: List<Deco> = emptyList(),
)

private val PLACES: Map<String, PlaceArt> = mapOf(
    "ufa" to PlaceArt(
        PlaceTone.Honey, R.drawable.place_ufa_hero, R.drawable.place_ufa_sign,
        heroAlt = "Уфа: берег реки Белой и памятник Салавату Юлаеву на скале",
        decos = listOf(
            Deco(R.drawable.deco_ufa_tram, -118f, 18f, 104f, rot = -3f, motion = DecoMotion.Roll),
            Deco(R.drawable.deco_ufa_river_bank, 150f, 70f, 74f, flip = true),
            Deco(R.drawable.deco_ufa_monument, 124f, 248f, 156f),
            Deco(R.drawable.deco_ufa_tram, -142f, 512f, 62f, flip = true, motion = DecoMotion.Roll),
            Deco(R.drawable.deco_ufa_river_bank, -128f, 770f, 178f),
        ),
    ),
    "shulgantash" to PlaceArt(
        PlaceTone.Green, R.drawable.place_shulgantash_hero, R.drawable.place_shulgantash_sign, signOnDark = true, signCalm = 0.40f,
        heroAlt = "Шульган-Таш: пещера в скале, река и сосна с бортью",
        decos = listOf(
            Deco(R.drawable.deco_shulgantash_bear_paw, -132f, 46f, 80f, rot = -6f),
            Deco(R.drawable.deco_shulgantash_bort, 138f, 236f, 128f, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_shulgantash_hive, 66f, 318f, 58f, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_shulgantash_bear_paw, 150f, 520f, 52f, flip = true, rot = 8f),
            Deco(R.drawable.deco_shulgantash_cave, -126f, 752f, 188f),
            Deco(R.drawable.deco_shulgantash_bort, 152f, 905f, 70f, flip = true, motion = DecoMotion.Sway),
        ),
    ),
    "agidel" to PlaceArt(
        PlaceTone.Water, R.drawable.place_agidel_hero, R.drawable.place_agidel_sign, signCalm = 0.40f,
        heroAlt = "Агидель: река между скал и каяк",
        decos = listOf(
            Deco(R.drawable.deco_agidel_fish, -128f, 36f, 66f, rot = -12f, motion = DecoMotion.Leap),
            Deco(R.drawable.deco_agidel_fish, 150f, 150f, 46f, flip = true, rot = 10f, motion = DecoMotion.Leap),
            Deco(R.drawable.deco_agidel_boat, 122f, 262f, 168f, rot = -4f, motion = DecoMotion.Rock),
            Deco(R.drawable.deco_agidel_reeds, 150f, 520f, 48f, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_agidel_reeds, -146f, 636f, 84f, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_agidel_reeds, -96f, 676f, 54f, flip = true, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_agidel_rock, -134f, 880f, 124f),
        ),
    ),
    "yamantau" to PlaceArt(
        PlaceTone.Green, R.drawable.place_yamantau_hero, R.drawable.place_yamantau_sign,
        heroAlt = "Гора Ямантау: хребты в тумане, ельник и горная речка",
        decos = listOf(
            Deco(R.drawable.deco_yamantau_elk, -128f, 44f, 76f),
            Deco(R.drawable.deco_yamantau_spruce, 152f, 120f, 64f, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_yamantau_peak, 120f, 262f, 176f),
            Deco(R.drawable.deco_yamantau_spruce, 58f, 352f, 50f, flip = true, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_yamantau_elk, 150f, 540f, 50f, flip = true),
            Deco(R.drawable.deco_yamantau_spruce, -150f, 622f, 70f, flip = true, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_yamantau_waterfall, -122f, 778f, 176f),
        ),
    ),
    "village" to PlaceArt(
        PlaceTone.Honey, R.drawable.place_village_hero, R.drawable.place_village_sign,
        heroAlt = "Башкирская деревня: бревенчатые дома с резными наличниками, пасека и цветущий луг",
        decos = listOf(
            Deco(R.drawable.deco_village_geese, -126f, 44f, 84f, motion = DecoMotion.Roll),
            Deco(R.drawable.deco_village_well, 150f, 118f, 54f),
            Deco(R.drawable.deco_village_house, 120f, 256f, 168f),
            Deco(R.drawable.deco_village_hives, 70f, 352f, 72f),
            Deco(R.drawable.deco_village_geese, 148f, 534f, 58f, flip = true, motion = DecoMotion.Roll),
            Deco(R.drawable.deco_village_hives, -146f, 628f, 84f, flip = true),
            Deco(R.drawable.deco_village_well, -124f, 782f, 124f),
            Deco(R.drawable.deco_village_house, 150f, 904f, 72f, flip = true),
        ),
    ),
    "sabantuy" to PlaceArt(
        PlaceTone.Water, R.drawable.place_sabantuy_hero, R.drawable.place_sabantuy_sign,
        heroAlt = "Сабантуй: высокий столб с подарками, флажки, шатры и скачки на лугу",
        decos = listOf(
            Deco(R.drawable.deco_sabantuy_horse, -124f, 46f, 94f, motion = DecoMotion.Rock),
            Deco(R.drawable.deco_sabantuy_flags, 118f, 120f, 120f, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_sabantuy_pole, 136f, 262f, 98f),
            Deco(R.drawable.deco_sabantuy_flags, 140f, 530f, 76f, flip = true, motion = DecoMotion.Sway),
            Deco(R.drawable.deco_sabantuy_horse, -150f, 616f, 62f, flip = true, motion = DecoMotion.Rock),
            Deco(R.drawable.deco_sabantuy_swing, -122f, 774f, 164f),
            Deco(R.drawable.deco_sabantuy_pole, 152f, 900f, 54f, flip = true),
        ),
    ),
)

private val FALLBACK = PlaceArt(PlaceTone.Honey)

fun placeArt(slug: String): PlaceArt = PLACES[slug] ?: FALLBACK

/** Смещения узлов от оси тропы (prototype OFFSETS): плавная «змейка» по 8 узлов, dp. */
val NODE_OFFSETS: List<Float> = listOf(0f, -58f, -86f, -58f, 0f, 58f, 86f, 58f)

/** Высота ряда узла и середина ячейки от верха ряда, dp (prototype ROW, NODE_MID). */
const val NODE_ROW: Float = 116f
const val NODE_MID: Float = 37f

/** Запас над текущим узлом под пузырь «Начать», dp. */
const val BUBBLE_GAP: Float = 36f

fun offsetOf(i: Int): Float = NODE_OFFSETS[i % NODE_OFFSETS.size]
