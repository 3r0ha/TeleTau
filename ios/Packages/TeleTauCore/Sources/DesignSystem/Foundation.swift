import SwiftUI
#if canImport(UIKit)
import UIKit
public typealias PlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
public typealias PlatformImage = NSImage
#endif

// MARK: - Возрастной режим

/// Режим интерфейса по возрасту (docs/05 §7, `Me.uiMode`): «Пчёлка» 1–4 класс, «Бортник» 5–8, «Хранитель» 9–11.
public enum TeleTauMode: String, Sendable, CaseIterable {
    case bee, bortnik, keeper

    /// Цель нажатия: в «Пчёлке» — 56 pt (`size.touchChild`), иначе 44 pt.
    public var touchTarget: CGFloat { self == .bee ? TeleTauSize.touchChild : TeleTauSize.touchMin }
    /// Высота кнопки действия: в «Пчёлке» — 56 pt, как в вебе (`ui.css`, `data-mode="bee"`).
    public var buttonHeight: CGFloat { self == .bee ? TeleTauSize.touchChild : TeleTauSize.button }
    /// Крупнее текст в «Пчёлке»: `fontScale.bee` = 1,125 = bodyLarge / body (в Swift-токены множитель не выводится).
    public var fontScale: CGFloat { self == .bee ? TeleTauFontSize.bodyLarge / TeleTauFontSize.body : 1 }
    /// В «Хранителе» меньше маскота: без пчелы у задания и на тропе (docs/05 §7, как `learn.css`).
    public var showsMascot: Bool { self != .keeper }
    /// Размер учебного башкирского текста: в «Пчёлке» — 22 pt (`fontSize.title3`), иначе 18 pt.
    public var learningText: CGFloat { self == .bee ? TeleTauFontSize.title3 : TeleTauFontSize.bodyLarge }
}

public extension EnvironmentValues {
    @Entry var teletauMode: TeleTauMode = .bortnik
    /// Рендер без платформенных контролов (ImageRenderer в тестах не рисует ScrollView, TextField и камеру):
    /// экран показывает то же содержимое статично.
    @Entry var teletauStaticRender: Bool = false
}

// MARK: - Иконки Phosphor

/// Иконка Phosphor как фигура: контуры SVG в сетке 256×256, вписанные в отведённый квадрат.
public struct TeleTauIconShape: Shape {
    public let icon: TeleTauIcon

    public init(_ icon: TeleTauIcon) {
        self.icon = icon
    }

    public func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let scale = side / 256
        let transform = CGAffineTransform(translationX: rect.midX - side / 2, y: rect.midY - side / 2).scaledBy(x: scale, y: scale)
        return SVGPathCache.path(for: icon).applying(transform)
    }
}

/// Иконка размером `size` цвета текущего `foregroundStyle`; декоративная для VoiceOver (смысл — в подписи рядом).
public struct IconView: View {
    let icon: TeleTauIcon
    let size: CGFloat

    public init(_ icon: TeleTauIcon, size: CGFloat = TeleTauSize.icon) {
        self.icon = icon
        self.size = size
    }

    public var body: some View {
        TeleTauIconShape(icon)
            .fill(style: FillStyle(eoFill: false))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

enum SVGPathCache {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [TeleTauIcon: Path] = [:]

    static func path(for icon: TeleTauIcon) -> Path {
        lock.withLock {
            if let p = cache[icon] { return p }
            var p = Path()
            for d in icon.svgPaths { p.addPath(SVGPath.parse(d)) }
            cache[icon] = p
            return p
        }
    }
}

/// Разбор SVG-контура `d` (M L H V C S Q T A Z, абсолютные и относительные) в `Path`.
public enum SVGPath {
    public static func parse(_ d: String) -> Path {
        var path = Path()
        var scanner = Tokens(Array(d.utf8))
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var lastQuad: CGPoint?
        var command: UInt8 = 0

        while let next = scanner.nextCommand(previous: command) {
            command = next
            let relative = command >= 97 // строчная буква
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y) }
            switch command | 0x20 {
            case UInt8(ascii: "m"):
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = pt(x, y)
                start = current
                path.move(to: current)
                // Следующие пары после M — неявные L.
                command = relative ? UInt8(ascii: "l") : UInt8(ascii: "L")
                lastControl = nil; lastQuad = nil
            case UInt8(ascii: "l"):
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = pt(x, y)
                path.addLine(to: current)
                lastControl = nil; lastQuad = nil
            case UInt8(ascii: "h"):
                guard let x = scanner.number() else { return path }
                current = CGPoint(x: relative ? current.x + x : x, y: current.y)
                path.addLine(to: current)
                lastControl = nil; lastQuad = nil
            case UInt8(ascii: "v"):
                guard let y = scanner.number() else { return path }
                current = CGPoint(x: current.x, y: relative ? current.y + y : y)
                path.addLine(to: current)
                lastControl = nil; lastQuad = nil
            case UInt8(ascii: "c"):
                guard let x1 = scanner.number(), let y1 = scanner.number(), let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c1 = pt(x1, y1), c2 = pt(x2, y2), end = pt(x, y)
                path.addCurve(to: end, control1: c1, control2: c2)
                current = end; lastControl = c2; lastQuad = nil
            case UInt8(ascii: "s"):
                guard let x2 = scanner.number(), let y2 = scanner.number(), let x = scanner.number(), let y = scanner.number() else { return path }
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = pt(x2, y2), end = pt(x, y)
                path.addCurve(to: end, control1: c1, control2: c2)
                current = end; lastControl = c2; lastQuad = nil
            case UInt8(ascii: "q"):
                guard let x1 = scanner.number(), let y1 = scanner.number(), let x = scanner.number(), let y = scanner.number() else { return path }
                let c = pt(x1, y1), end = pt(x, y)
                path.addQuadCurve(to: end, control: c)
                current = end; lastQuad = c; lastControl = nil
            case UInt8(ascii: "t"):
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                let c = lastQuad.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let end = pt(x, y)
                path.addQuadCurve(to: end, control: c)
                current = end; lastQuad = c; lastControl = nil
            case UInt8(ascii: "a"):
                guard let rx = scanner.number(), let ry = scanner.number(), let rot = scanner.number(),
                      let large = scanner.flag(), let sweep = scanner.flag(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let end = pt(x, y)
                addArc(&path, from: current, to: end, rx: rx, ry: ry, rotation: rot, large: large, sweep: sweep)
                current = end; lastControl = nil; lastQuad = nil
            case UInt8(ascii: "z"):
                path.closeSubpath()
                current = start
                lastControl = nil; lastQuad = nil
            default:
                return path
            }
        }
        return path
    }

    /// Дуга SVG (эндпоинт-параметризация) → кривые Безье: SVG 1.1, приложение F.6.5.
    static func addArc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx: CGFloat, ry: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool) {
        var rx = abs(rx), ry = abs(ry)
        guard rx > 0, ry > 0, p0 != p1 else { path.addLine(to: p1); return }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 { rx *= lambda.squareRoot(); ry *= lambda.squareRoot() }
        let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        var coef = (max(0, num) / den).squareRoot()
        if large == sweep { coef = -coef }
        let cxp = coef * rx * y1p / ry
        let cyp = -coef * ry * x1p / rx
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep, delta > 0 { delta -= 2 * .pi }
        if sweep, delta < 0 { delta += 2 * .pi }
        let segments = Int((abs(delta) / (.pi / 2)).rounded(.up))
        let step = delta / CGFloat(max(1, segments))
        let t = 4 / 3 * tan(step / 4)
        var theta = theta1
        for _ in 0..<max(1, segments) {
            let cos1 = cos(theta), sin1 = sin(theta)
            let cos2 = cos(theta + step), sin2 = sin(theta + step)
            func map(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: cx + rx * x * cosPhi - ry * y * sinPhi, y: cy + rx * x * sinPhi + ry * y * cosPhi)
            }
            let c1 = map(cos1 - t * sin1, sin1 + t * cos1)
            let c2 = map(cos2 + t * sin2, sin2 - t * cos2)
            let end = map(cos2, sin2)
            path.addCurve(to: end, control1: c1, control2: c2)
            theta += step
        }
    }

    struct Tokens {
        let bytes: [UInt8]
        var i = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        mutating func skipSeparators() {
            while i < bytes.count, bytes[i] == 0x20 || bytes[i] == 0x2C || bytes[i] == 0x0A || bytes[i] == 0x09 || bytes[i] == 0x0D { i += 1 }
        }

        static func isCommand(_ b: UInt8) -> Bool {
            "MmLlHhVvCcSsQqTtAaZz".utf8.contains(b)
        }

        /// Буква команды; если дальше число — повтор предыдущей команды (неявная команда SVG).
        mutating func nextCommand(previous: UInt8) -> UInt8? {
            skipSeparators()
            guard i < bytes.count else { return nil }
            if Self.isCommand(bytes[i]) { defer { i += 1 }; return bytes[i] }
            return previous == 0 || previous | 0x20 == UInt8(ascii: "z") ? nil : previous
        }

        mutating func flag() -> Bool? {
            skipSeparators()
            guard i < bytes.count, bytes[i] == UInt8(ascii: "0") || bytes[i] == UInt8(ascii: "1") else { return nil }
            defer { i += 1 }
            return bytes[i] == UInt8(ascii: "1")
        }

        mutating func number() -> CGFloat? {
            skipSeparators()
            let startIndex = i
            if i < bytes.count, bytes[i] == UInt8(ascii: "-") || bytes[i] == UInt8(ascii: "+") { i += 1 }
            var seenDot = false, seenDigit = false
            while i < bytes.count {
                let b = bytes[i]
                if (0x30...0x39).contains(b) { seenDigit = true; i += 1 }
                else if b == UInt8(ascii: "."), !seenDot { seenDot = true; i += 1 }
                else if (b == UInt8(ascii: "e") || b == UInt8(ascii: "E")), seenDigit {
                    i += 1
                    if i < bytes.count, bytes[i] == UInt8(ascii: "-") || bytes[i] == UInt8(ascii: "+") { i += 1 }
                } else { break }
            }
            guard seenDigit, let s = String(bytes: bytes[startIndex..<i], encoding: .ascii), let v = Double(s) else { i = startIndex; return nil }
            return CGFloat(v)
        }
    }
}

// MARK: - Иллюстрации

/// Загрузка картинок пакета: PNG из `Resources/Illustrations` (одинаково в приложении и в `swift test`), с кешем.
public enum IllustrationStore {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [Illustration: PlatformImage] = [:]

    public static func image(_ illustration: Illustration) -> PlatformImage? {
        lock.withLock {
            if let cached = cache[illustration] { return cached }
            let loaded = load(illustration.rawValue)
            if let loaded { cache[illustration] = loaded }
            return loaded
        }
    }

    private static func load(_ name: String) -> PlatformImage? {
        guard let url = Bundle.module.url(forResource: name, withExtension: "png", subdirectory: "Illustrations") else { return nil }
        #if canImport(UIKit)
        return UIImage(contentsOfFile: url.path)
        #else
        return NSImage(contentsOf: url)
        #endif
    }

    /// Пропорция ширина/высота (для раскладки до загрузки).
    public static func aspect(_ illustration: Illustration) -> CGFloat {
        guard let size = image(illustration)?.size, size.height > 0 else { return 1 }
        return size.width / size.height
    }
}

/// Картинка единой серии шириной `width` (высота — по пропорции). Без `label` — декоративная для VoiceOver.
public struct IllustrationView: View {
    let illustration: Illustration
    let width: CGFloat?
    let label: String?

    public init(_ illustration: Illustration, width: CGFloat? = nil, label: String? = nil) {
        self.illustration = illustration
        self.width = width
        self.label = label
    }

    public var body: some View {
        Group {
            if let image = IllustrationStore.image(illustration) {
                #if canImport(UIKit)
                Image(uiImage: image).resizable()
                #else
                Image(nsImage: image).resizable()
                #endif
            } else {
                Color.clear
            }
        }
        .aspectRatio(IllustrationStore.aspect(illustration), contentMode: .fit)
        .frame(width: width)
        .accessibilityElement()
        .accessibilityLabel(label.map { Text($0) } ?? Text(""))
        .accessibilityHidden(label == nil)
        .accessibilityAddTraits(label == nil ? [] : .isImage)
    }
}

/// Картинка, заполняющая полосу высотой `height` с обрезкой (`object-fit: cover`); `anchor` — какая часть видна.
public struct IllustrationFill: View {
    let illustration: Illustration
    let height: CGFloat
    let anchor: UnitPoint
    let label: String?

    public init(_ illustration: Illustration, height: CGFloat, anchor: UnitPoint = .center, label: String? = nil) {
        self.illustration = illustration
        self.height = height
        self.anchor = anchor
        self.label = label
    }

    public var body: some View {
        GeometryReader { geo in
            let a = IllustrationStore.aspect(illustration)
            let w = geo.size.width, h = geo.size.height
            let wide = w / max(h, 1) > a
            let imgW = wide ? w : h * a
            let imgH = wide ? w / a : h
            IllustrationView(illustration)
                .frame(width: imgW, height: imgH)
                .offset(x: -(imgW - w) * anchor.x, y: -(imgH - h) * anchor.y)
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipped()
        .accessibilityElement()
        .accessibilityLabel(label.map { Text($0) } ?? Text(""))
        .accessibilityHidden(label == nil)
    }
}

// MARK: - Шестиугольник с плоским верхом

/// Скруглённый шестиугольник с плоским верхом, вписанный в прямоугольник (узлы тропы, аватары, соты; порт `hexPath`).
public struct RoundedHex: Shape {
    public var cornerRadius: CGFloat

    public init(cornerRadius: CGFloat) {
        self.cornerRadius = cornerRadius
    }

    public func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        let pts = [
            CGPoint(x: w * 0.25, y: 0), CGPoint(x: w * 0.75, y: 0), CGPoint(x: w, y: h / 2),
            CGPoint(x: w * 0.75, y: h), CGPoint(x: w * 0.25, y: h), CGPoint(x: 0, y: h / 2),
        ].map { CGPoint(x: $0.x + rect.minX, y: $0.y + rect.minY) }
        func toward(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
            let dx = b.x - a.x, dy = b.y - a.y
            let len = max(0.001, (dx * dx + dy * dy).squareRoot())
            return CGPoint(x: a.x + dx / len * cornerRadius, y: a.y + dy / len * cornerRadius)
        }
        var path = Path()
        for (i, v) in pts.enumerated() {
            let a = toward(v, pts[(i + 5) % 6])
            let b = toward(v, pts[(i + 1) % 6])
            if i == 0 { path.move(to: a) } else { path.addLine(to: a) }
            path.addQuadCurve(to: b, control: v)
        }
        path.closeSubpath()
        return path
    }
}
