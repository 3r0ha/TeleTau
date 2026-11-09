// СГЕНЕРИРОВАНО из packages/design-tokens/tokens (W3C DTCG). Не редактировать вручную.
// Перегенерация: pnpm --filter @teletau/design-tokens build

import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Семантические цвета «Борть». Каждый цвет автоматически переключается между светлой и тёмной темой.
public enum TeleTauColor {
    /// Фон экрана
    public static let bg = Color(ttLight: 0xFFFCF5, ttDark: 0x131F24)
    /// Крем: фон вокруг колонки на широком экране, утопленные области
    public static let bgSunken = Color(ttLight: 0xFFF8EC, ttDark: 0x0D171B)
    /// Карточки, листы, поля ввода
    public static let surface = Color(ttLight: 0xFFFFFF, ttDark: 0x1C2B32)
    /// Шоколадный текст
    public static let textPrimary = Color(ttLight: 0x3B2716, ttDark: 0xF1F7FB)
    public static let textSecondary = Color(ttLight: 0x6F5B47, ttDark: 0xC6D3DA)
    /// Подписи, кикеры, неактивные вкладки
    public static let textTertiary = Color(ttLight: 0x85705B, ttDark: 0x95A8B2)
    /// Текст на ярких заливках (мёд, зелень, вода, коралл) — тёмный в обеих темах (шоколадный в светлой, графитовый в тёмной): белый на них не проходит AA
    public static let textOnFill = Color(ttLight: 0x3B2716, ttDark: 0x131F24)
    /// Мёд: главная кнопка, прогресс, пройденные ячейки. Не для текста
    public static let accentFill = Color(ttLight: 0xFFB703, ttDark: 0xFFB703)
    /// Глубокий мёд: «губа» медовой кнопки и ячейки
    public static let accentLip = Color(ttLight: 0xE39400, ttDark: 0xB87400)
    /// Текст-акцент мёда, ссылки
    public static let accentText = Color(ttLight: 0x8A5200, ttDark: 0xFFC94D)
    /// Текст на медовой заливке
    public static let accentOn = Color(ttLight: 0x3B2716, ttDark: 0x131F24)
    /// Медовая подложка: чипы, выбранная строка, активная вкладка
    public static let accentSoft = Color(ttLight: 0xFFF3D1, ttDark: 0x2F2A14)
    /// Граница медовой подложки
    public static let accentSoftBorder = Color(ttLight: 0xFFD979, ttDark: 0x5E4E1A)
    /// Зелень: «верно», успех
    public static let successFill = Color(ttLight: 0x43C35E, ttDark: 0x43C35E)
    public static let successLip = Color(ttLight: 0x2C9C45, ttDark: 0x26843A)
    public static let successText = Color(ttLight: 0x1E7A33, ttDark: 0x74DB8B)
    public static let successSoft = Color(ttLight: 0xE7F8EA, ttDark: 0x183A2B)
    /// Вода (Агидель): информация, задания учителя
    public static let infoFill = Color(ttLight: 0x1CA7F2, ttDark: 0x1CA7F2)
    public static let infoLip = Color(ttLight: 0x0B87CB, ttDark: 0x0A73AD)
    public static let infoText = Color(ttLight: 0x0A6597, ttDark: 0x6CC8FF)
    public static let infoSoft = Color(ttLight: 0xE4F4FE, ttDark: 0x133A4E)
    /// Коралл: ошибка, опасное действие (всегда с иконкой или текстом, не только цветом)
    public static let dangerFill = Color(ttLight: 0xFF5A5A, ttDark: 0xFF6464)
    public static let dangerLip = Color(ttLight: 0xE03B3B, ttDark: 0xC93636)
    public static let dangerText = Color(ttLight: 0xB3261E, ttDark: 0xFF8F86)
    public static let dangerSoft = Color(ttLight: 0xFFECEA, ttDark: 0x44242A)
    /// Фиолетовая кнопка («Помоги языку»). Единственная заливка с белым текстом
    public static let violetFill = Color(ttLight: 0x7B3CE6, ttDark: 0x7B3CE6)
    public static let violetLip = Color(ttLight: 0x5E26C0, ttDark: 0x5420B0)
    public static let violetText = Color(ttLight: 0x6B2ED6, ttDark: 0xC7A6FF)
    public static let violetSoft = Color(ttLight: 0xF2EBFF, ttDark: 0x2E2753)
    /// Яркий фиолетовый для узлов и иконок (не для текста)
    public static let violetBright = Color(ttLight: 0x9B5CFF, ttDark: 0xA673FF)
    /// Текст на фиолетовой заливке
    public static let violetOn = Color(ttLight: 0xFFFFFF, ttDark: 0xFFFFFF)
    /// Огонь серии (прототип v2): иконка пламени, крупное число дней на экране серии, ячейки дней. Не для мелкого текста (≥ 3:1 — только иконки и крупный текст)
    public static let streakFill = Color(ttLight: 0xE8590C, ttDark: 0xFF7A2F)
    /// «Губа» огненной ячейки и кнопки
    public static let streakLip = Color(ttLight: 0xC2470A, ttDark: 0xC2500F)
    /// Текст серии обычного размера: счётчик в шапке, «6 дней подряд» (≥ 4.5:1)
    public static let streakText = Color(ttLight: 0xB23F07, ttDark: 0xFFA36B)
    /// Подложка серии: чип, ячейка дня с заморозкой рядом
    public static let streakSoft = Color(ttLight: 0xFFEDE2, ttDark: 0x40271A)
    /// Воск: закрытое, недоступное
    public static let lockedFill = Color(ttLight: 0xECE5D9, ttDark: 0x2E3D45)
    public static let lockedLip = Color(ttLight: 0xD6CCBC, ttDark: 0x222F36)
    /// Текст недоступного элемента (WCAG не требует контраста для неактивных)
    public static let lockedText = Color(ttLight: 0xA99D8B, ttDark: 0x7F929C)
    /// Декоративные границы карточек и разделители
    public static let borderSubtle = Color(ttLight: 0xF0E6D4, ttDark: 0x2A3A42)
    /// Границы плиток и вторичных кнопок, их «губа»
    public static let borderDefault = Color(ttLight: 0xE2D4BC, ttDark: 0x37464F)
    /// Границы полей ввода и контролов (≥ 3:1, WCAG 1.4.11)
    public static let borderStrong = Color(ttLight: 0xA08A72, ttDark: 0x6D818B)
    /// Кольцо фокуса клавиатуры (≥ 3:1)
    public static let focus = Color(ttLight: 0x0B87CB, ttDark: 0x6CC8FF)
    /// Затемнение под листом и диалогом (с прозрачностью в компоненте)
    public static let scrim = Color(ttLight: 0x3B2716, ttDark: 0x000000)
    /// Блик на ярких заливках (прогресс, ячейки) — с прозрачностью в компоненте
    public static let highlight = Color(ttLight: 0xFFFFFF, ttDark: 0xFFFFFF)
    /// Подложка места: Уфа
    public static let zoneHoney = Color(ttLight: 0xFFF5DC, ttDark: 0x23251F)
    /// Подложка места: Шульган-Таш
    public static let zoneGreen = Color(ttLight: 0xEDF6E7, ttDark: 0x15292A)
    /// Подложка места: Агидель
    public static let zoneWater = Color(ttLight: 0xE8F4FB, ttDark: 0x132A35)
}

public enum TeleTauSpace {
    public static let s050: CGFloat = 2
    public static let s100: CGFloat = 4
    public static let s150: CGFloat = 6
    public static let s200: CGFloat = 8
    public static let s250: CGFloat = 10
    public static let s300: CGFloat = 12
    public static let s350: CGFloat = 14
    public static let s400: CGFloat = 16
    public static let s450: CGFloat = 18
    public static let s500: CGFloat = 20
    public static let s600: CGFloat = 24
    public static let s800: CGFloat = 32
    public static let s1000: CGFloat = 40
    public static let s1200: CGFloat = 48
    public static let s1600: CGFloat = 64
}

public enum TeleTauRadius {
    public static let small: CGFloat = 8
    public static let mark: CGFloat = 9
    public static let brand: CGFloat = 10
    public static let iconButton: CGFloat = 12
    public static let tile: CGFloat = 14
    public static let button: CGFloat = 16
    public static let panel: CGFloat = 20
    public static let card: CGFloat = 24
    public static let sheet: CGFloat = 28
    public static let chip: CGFloat = 999
}

public enum TeleTauSize {
    /// Минимальная цель нажатия (режимы «Бортник», «Хранитель»; на Android Compose сам расширяет область нажатия до 48 dp)
    public static let touchMin: CGFloat = 44
    /// Цель нажатия в режиме «Пчёлка» (1–4 класс): в вебе заменяет touchMin и высоту кнопки
    public static let touchChild: CGFloat = 56
    /// Высота кнопки действия
    public static let button: CGFloat = 52
    /// «Губа» кнопки: нижняя кромка глубокого цвета, при нажатии кнопка опускается на неё
    public static let lip: CGFloat = 4
    /// «Губа» плитки и варианта ответа
    public static let lipSmall: CGFloat = 3
    /// Толщина кольца фокуса
    public static let focusRing: CGFloat = 3
    /// Высота прогресс-бара
    public static let progress: CGFloat = 14
    public static let iconSmall: CGFloat = 20
    public static let icon: CGFloat = 24
    public static let iconLarge: CGFloat = 28
    /// Колонка экранов ученика и входа на широком экране
    public static let columnNarrow: CGFloat = 480
    /// Колонка кабинета учителя и консоли
    public static let columnWide: CGFloat = 1120
}

public enum TeleTauFontSize {
    public static let caption: CGFloat = 12
    /// Чипы, кикеры, подписи вкладок
    public static let label: CGFloat = 13
    public static let footnote: CGFloat = 14
    public static let callout: CGFloat = 15
    public static let body: CGFloat = 16
    /// Надпись кнопки (Nunito)
    public static let button: CGFloat = 17
    /// Минимум для учебного башкирского текста
    public static let bodyLarge: CGFloat = 18
    /// Заголовок карточки
    public static let headline: CGFloat = 19
    /// Заголовок листа и диалога; учебный башкирский текст в режиме «Пчёлка»
    public static let title3: CGFloat = 22
    /// Заголовок страницы
    public static let title2: CGFloat = 26
    /// Заголовок полноэкранного состояния
    public static let title1: CGFloat = 30
    /// Название на заставке
    public static let display: CGFloat = 44
    /// Код класса на доске — читается с последней парты
    public static let board: CGFloat = 88
}

public enum TeleTauFontFamily {
    /// Текст. Полное покрытие башкирских букв (research/02 §F4)
    public static let text = "Golos Text"
    /// Заголовки, цифры, кнопки, режим «Пчёлка». locl BSH. У вариативного файла вес по умолчанию 200 — вес задаётся явно
    public static let display = "Nunito"
}

/// Начертания. У вариативного Nunito вес по умолчанию 200 — вес задаётся явно.
public enum TeleTauFontWeight {
    public static let regular: Font.Weight = .regular
    public static let medium: Font.Weight = .medium
    public static let semibold: Font.Weight = .semibold
    public static let bold: Font.Weight = .bold
    /// Кнопки, чипы, подписи (Nunito)
    public static let extrabold: Font.Weight = .heavy
    /// Заголовки и цифры (Nunito)
    public static let black: Font.Weight = .black
}

/// Межстрочный интервал — множитель размера шрифта.
public enum TeleTauLineHeight {
    /// Крупные заголовки
    public static let tight: CGFloat = 1.1
    public static let snug: CGFloat = 1.25
    /// Основной текст
    public static let body: CGFloat = 1.45
}

/// Длительности анимаций в секундах.
public enum TeleTauDuration {
    /// Нажатие кнопки на «губу»
    public static let press: Double = 0.08
    public static let fast: Double = 0.12
    public static let base: Double = 0.2
    public static let slow: Double = 0.4
    /// Оборот индикатора «идёт действие» на кнопке
    public static let spin: Double = 0.9
    /// Проход блика по скелетону загрузки
    public static let shimmer: Double = 1.4
    /// Парение пчелы на заставке (цикл)
    public static let drift: Double = 2.4
    /// Шаг задержки: звенья сот серии загораются по очереди
    public static let stagger: Double = 0.11
    /// Кадр «глаза закрыты» при моргании пчелы
    public static let blink: Double = 0.15
    /// Смена кадра крыльев, когда пчела трепещет крыльями
    public static let flap: Double = 0.11
    /// Короткое покачивание при неверном ответе
    public static let shake: Double = 0.42
    /// Вспышка и капли мёда при верном ответе
    public static let burst: Double = 0.72
    /// Появление с подъёмом: значок лиги, звено серии, баннер
    public static let rise: Double = 0.7
    /// Прыжок пчелы со сжатием на итоге урока
    public static let hop: Double = 0.9
    /// Счётчик мёда «набегает» на итоге урока
    public static let count: Double = 1
    /// Тропинка дорисовывается до текущего узла
    public static let draw: Double = 1.1
    /// Блик проходит по значку лиги
    public static let glint: Double = 1.1
    /// Мерцание огня серии (цикл)
    public static let flicker: Double = 1.5
    /// Подпрыгивание пузыря «Начать» (цикл)
    public static let bob: Double = 1.6
    /// «Дыхание» кольца текущего узла тропы (цикл)
    public static let breath: Double = 2
    /// Падение конфетти из маленьких сот
    public static let confetti: Double = 2.2
    /// Пчела плавает вверх-вниз (цикл)
    public static let float: Double = 3
    /// Пауза между морганиями: от одной до двух таких пауз (3–6 с)
    public static let blinkGap: Double = 3
    /// Лодка качается на волне (цикл)
    public static let rock: Double = 3.2
    /// Декорации тропы покачиваются от основания (цикл)
    public static let sway: Double = 3.6
    /// Рыба выпрыгивает из воды — прыжок и пауза (цикл)
    public static let leap: Double = 5.2
    /// Трамвай чуть катается туда-сюда (цикл)
    public static let roll: Double = 6
}

/// Кривые анимаций.
public enum TeleTauEasing {
    /// Появление листов, диалогов, тостов
    public static let out = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.2, y: 0.8), endControlPoint: UnitPoint(x: 0.2, y: 1))
    /// Плавные циклы: покачивание, парение, дыхание
    public static let inOut = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.45, y: 0), endControlPoint: UnitPoint(x: 0.55, y: 1))
    /// Пружина с перелётом: прыжок, подъём значка, пузырь
    public static let spring = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.34, y: 1.56), endControlPoint: UnitPoint(x: 0.64, y: 1))
    /// Падение с ускорением: капли мёда, конфетти
    public static let fall = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.55, y: 0), endControlPoint: UnitPoint(x: 1, y: 0.45))
}

extension Color {
    init(ttLight: UInt32, ttDark: UInt32) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(ttHex: ttDark) : UIColor(ttHex: ttLight)
        })
        #elseif canImport(AppKit)
        self.init(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(ttHex: ttDark) : NSColor(ttHex: ttLight)
        })
        #endif
    }
}

#if canImport(UIKit)
extension UIColor {
    convenience init(ttHex: UInt32) {
        self.init(
            red: CGFloat((ttHex >> 16) & 0xFF) / 255,
            green: CGFloat((ttHex >> 8) & 0xFF) / 255,
            blue: CGFloat(ttHex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#elseif canImport(AppKit)
extension NSColor {
    convenience init(ttHex: UInt32) {
        self.init(
            srgbRed: CGFloat((ttHex >> 16) & 0xFF) / 255,
            green: CGFloat((ttHex >> 8) & 0xFF) / 255,
            blue: CGFloat(ttHex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#endif
