import DesignSystem
import SwiftUI

// Оформление мест экспедиции на тропе (docs/05 §0, решения 2–3) — порт `places.ts` веба: подложка места, вывеска,
// иллюстрация карточки экспедиции и декорации. Декорации — композиция, а не сетка: один крупный «якорь», уходящий
// за край, рядом мелочь в другом масштабе и зеркально — на стороне, противоположной изгибу тропы. Координаты — из
// утверждённого прототипа: x — от оси тропы, y — от верха дорожки юнита, w — ширина, pt.

enum PlaceTone: Sendable {
    case honey, green, water

    var zone: Color {
        switch self {
        case .honey: TeleTauColor.zoneHoney
        case .green: TeleTauColor.zoneGreen
        case .water: TeleTauColor.zoneWater
        }
    }

    var fill: Color {
        switch self {
        case .honey: TeleTauColor.accentFill
        case .green: TeleTauColor.successFill
        case .water: TeleTauColor.infoFill
        }
    }

    var lip: Color {
        switch self {
        case .honey: TeleTauColor.accentLip
        case .green: TeleTauColor.successLip
        case .water: TeleTauColor.infoLip
        }
    }
}

/// Движение декорации: покачивание от основания, трамвай катается, лодка качается, рыба выпрыгивает.
enum DecoMotion: Sendable { case sway, roll, rock, leap }

struct Deco: Sendable {
    let art: Illustration
    let x: CGFloat
    let y: CGFloat
    let w: CGFloat
    var flip = false
    var rot: Double = 0
    var motion: DecoMotion?
}

struct PlaceArt: Sendable {
    let tone: PlaceTone
    var hero: Illustration?
    var sign: Illustration?
    /// Текст вывески светлый (зелёная вывеска Шульган-Таша).
    var signOnDark = false
    var heroAlt: String?
    var decos: [Deco] = []

    static func of(_ slug: String) -> PlaceArt {
        places[slug] ?? PlaceArt(tone: .honey)
    }

    static let places: [String: PlaceArt] = [
        "ufa": PlaceArt(tone: .honey, hero: .placeUfaHero, sign: .placeUfaSign,
                        heroAlt: "Уфа: берег реки Белой и памятник Салавату Юлаеву на скале", decos: [
                            Deco(art: .decoUfaTram, x: -118, y: 18, w: 104, rot: -3, motion: .roll),
                            Deco(art: .decoUfaRiverBank, x: 150, y: 70, w: 74, flip: true),
                            Deco(art: .decoUfaMonument, x: 124, y: 248, w: 156),
                            Deco(art: .decoUfaTram, x: -142, y: 512, w: 62, flip: true, motion: .roll),
                            Deco(art: .decoUfaRiverBank, x: -128, y: 770, w: 178),
                        ]),
        "shulgantash": PlaceArt(tone: .green, hero: .placeShulgantashHero, sign: .placeShulgantashSign, signOnDark: true,
                                heroAlt: "Шульган-Таш: пещера в скале, река и сосна с бортью", decos: [
                                    Deco(art: .decoShulgantashBearPaw, x: -132, y: 46, w: 80, rot: -6),
                                    Deco(art: .decoShulgantashBort, x: 138, y: 236, w: 128, motion: .sway),
                                    Deco(art: .decoShulgantashHive, x: 66, y: 318, w: 58, motion: .sway),
                                    Deco(art: .decoShulgantashBearPaw, x: 150, y: 520, w: 52, flip: true, rot: 8),
                                    Deco(art: .decoShulgantashCave, x: -126, y: 752, w: 188),
                                    Deco(art: .decoShulgantashBort, x: 152, y: 905, w: 70, flip: true, motion: .sway),
                                ]),
        "agidel": PlaceArt(tone: .water, hero: .placeAgidelHero, sign: .placeAgidelSign,
                           heroAlt: "Агидель: река между скал и каяк", decos: [
                               Deco(art: .decoAgidelFish, x: -128, y: 36, w: 66, rot: -12, motion: .leap),
                               Deco(art: .decoAgidelFish, x: 150, y: 150, w: 46, flip: true, rot: 10, motion: .leap),
                               Deco(art: .decoAgidelBoat, x: 122, y: 262, w: 168, rot: -4, motion: .rock),
                               Deco(art: .decoAgidelReeds, x: 150, y: 520, w: 48, motion: .sway),
                               Deco(art: .decoAgidelReeds, x: -146, y: 636, w: 84, motion: .sway),
                               Deco(art: .decoAgidelReeds, x: -96, y: 676, w: 54, flip: true, motion: .sway),
                               Deco(art: .decoAgidelRock, x: -134, y: 880, w: 124),
                           ]),
        "yamantau": PlaceArt(tone: .green, hero: .placeYamantauHero, sign: .placeYamantauSign,
                             heroAlt: "Гора Ямантау: хребты в тумане, ельник и горная речка", decos: [
                                 Deco(art: .decoYamantauElk, x: -128, y: 44, w: 76),
                                 Deco(art: .decoYamantauSpruce, x: 152, y: 120, w: 64, motion: .sway),
                                 Deco(art: .decoYamantauPeak, x: 120, y: 262, w: 176),
                                 Deco(art: .decoYamantauSpruce, x: 58, y: 352, w: 50, flip: true, motion: .sway),
                                 Deco(art: .decoYamantauElk, x: 150, y: 540, w: 50, flip: true),
                                 Deco(art: .decoYamantauSpruce, x: -150, y: 622, w: 70, flip: true, motion: .sway),
                                 Deco(art: .decoYamantauWaterfall, x: -122, y: 778, w: 176),
                             ]),
        "village": PlaceArt(tone: .honey, hero: .placeVillageHero, sign: .placeVillageSign,
                            heroAlt: "Башкирская деревня: бревенчатые дома с резными наличниками, пасека и цветущий луг", decos: [
                                Deco(art: .decoVillageGeese, x: -126, y: 44, w: 84, motion: .roll),
                                Deco(art: .decoVillageWell, x: 150, y: 118, w: 54),
                                Deco(art: .decoVillageHouse, x: 120, y: 256, w: 168),
                                Deco(art: .decoVillageHives, x: 70, y: 352, w: 72),
                                Deco(art: .decoVillageGeese, x: 148, y: 534, w: 58, flip: true, motion: .roll),
                                Deco(art: .decoVillageHives, x: -146, y: 628, w: 84, flip: true),
                                Deco(art: .decoVillageWell, x: -124, y: 782, w: 124),
                                Deco(art: .decoVillageHouse, x: 150, y: 904, w: 72, flip: true),
                            ]),
        "sabantuy": PlaceArt(tone: .water, hero: .placeSabantuyHero, sign: .placeSabantuySign,
                             heroAlt: "Сабантуй: высокий столб с подарками, флажки, шатры и скачки на лугу", decos: [
                                 Deco(art: .decoSabantuyHorse, x: -124, y: 46, w: 94, motion: .rock),
                                 Deco(art: .decoSabantuyFlags, x: 118, y: 120, w: 120, motion: .sway),
                                 Deco(art: .decoSabantuyPole, x: 136, y: 262, w: 98),
                                 Deco(art: .decoSabantuyFlags, x: 140, y: 530, w: 76, flip: true, motion: .sway),
                                 Deco(art: .decoSabantuyHorse, x: -150, y: 616, w: 62, flip: true, motion: .rock),
                                 Deco(art: .decoSabantuySwing, x: -122, y: 774, w: 164),
                                 Deco(art: .decoSabantuyPole, x: 152, y: 900, w: 54, flip: true),
                             ]),
    ]
}

/// Геометрия дорожки (prototype OFFSETS, ROW, NODE_MID; `places.ts`).
enum TrackGeometry {
    /// Горизонтальные смещения узлов от оси тропы: плавная «змейка» по 8 узлов.
    static let offsets: [CGFloat] = [0, -58, -86, -58, 0, 58, 86, 58]
    /// Высота ряда узла и середина ячейки от верха ряда.
    static let row: CGFloat = 116
    static let nodeMid: CGFloat = 37
    /// Запас над текущим узлом под пузырь «Начать».
    static let bubbleGap: CGFloat = 36
    /// Ширина рисунка дорожки (ось — посередине).
    static let width: CGFloat = 360

    static func offset(_ i: Int) -> CGFloat { offsets[i % offsets.count] }

    /// Верх ряда узла: перед текущим узлом (не первым) — запас под пузырь.
    static func rowTop(_ i: Int, gapAt: Int) -> CGFloat {
        CGFloat(i) * row + (gapAt >= 0 && i >= gapAt ? bubbleGap : 0)
    }
}
