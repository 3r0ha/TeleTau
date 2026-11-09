import SwiftUI

/// Шестиугольник «Борть» — модуль сетки и формы (docs/05-design-system.md §2).
///
/// Правильный шестиугольник с вершиной сверху, вписанный в отведённый прямоугольник
/// с сохранением пропорций. Заливка и обводка задаются снаружи цветами из `TeleTauColor`.
public struct HexCell: Shape {
    /// Отношение ширины шестиугольника с вершиной сверху к его высоте: √3 / 2.
    public static let aspectRatio: CGFloat = 3.0.squareRoot() / 2

    public init() {}

    public func path(in rect: CGRect) -> Path {
        let radius = min(rect.height, rect.width / Self.aspectRatio) / 2
        let center = CGPoint(x: rect.midX, y: rect.midY)
        var path = Path()
        for index in 0..<6 {
            // Начинаем с верхней вершины и идём по часовой стрелке через каждые 60°.
            let angle = CGFloat(index) * .pi / 3 - .pi / 2
            let point = CGPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle))
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}
