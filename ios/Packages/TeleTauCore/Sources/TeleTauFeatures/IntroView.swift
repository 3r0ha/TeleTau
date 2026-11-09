import DesignSystem
import SwiftUI

/// Знакомство с пчелой при первом входе (как TrailIntro веба): два листа поверх тропы.
/// Первый — «Привет! Я пчела», второй — что такое урок и цель дня; «Пропустить» и «Посмотреть тропу» закрывают.
struct TrailIntroView: View {
    /// Цель дня в сотах (уроках).
    let goal: Int
    let onStart: @MainActor () -> Void
    let onClose: @MainActor () -> Void
    @State private var step: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.teletauMode) private var mode

    init(goal: Int, step: Int = 0, onStart: @escaping @MainActor () -> Void, onClose: @escaping @MainActor () -> Void) {
        self.goal = goal
        self.onStart = onStart
        self.onClose = onClose
        _step = State(initialValue: step)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            TeleTauColor.scrim.opacity(0.45).ignoresSafeArea()
            VStack(spacing: 0) {
                Group {
                    if step == 0 {
                        IllustrationView(.heroLanding, width: 320)
                            .clipShape(RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous))
                    } else {
                        IllustrationView(.sceneLessonComplete, width: 220)
                    }
                }
                .frame(height: 180)
                .accessibilityHidden(true)
                PageDots(count: 2, current: step)
                    .padding(.top, TeleTauSpace.s300)
                    .padding(.bottom, TeleTauSpace.s400)
                Text(step == 0 ? "Привет! Я пчела" : "Урок — сота мёда")
                    .teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text(step == 0 ? "Пойдём по тропе через весь Башкортостан."
                     : "Цель дня — \(goal) \(Format.plural(goal, ("сота", "соты", "сот"))). Заходи каждый день, чтобы не прервать серию.")
                    .teletauText(TeleTauFontSize.body)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, TeleTauSpace.s250)
                VStack(spacing: TeleTauSpace.s200) {
                    if step == 0 {
                        TeleTauButton("Дальше") { withAnimation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.base)) { step = 1 } }
                        LinkButton("Пропустить", tone: .neutral, action: onClose)
                    } else {
                        TeleTauButton("Начать урок", action: onStart)
                        LinkButton("Посмотреть тропу", tone: .neutral, action: onClose)
                    }
                }
                .padding(.top, TeleTauSpace.s600)
            }
            .id(step)
            .transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
            .padding(.top, TeleTauSpace.s500)
            .padding(.horizontal, TeleTauSpace.s450)
            .padding(.bottom, TeleTauSpace.s400)
            .frame(maxWidth: TeleTauSize.columnNarrow)
            .frame(maxWidth: .infinity)
            .background(TeleTauColor.bg, in: UnevenRoundedRectangle(topLeadingRadius: TeleTauRadius.sheet, topTrailingRadius: TeleTauRadius.sheet, style: .continuous))
            .ignoresSafeArea(edges: .bottom)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
    }
}

/// Точки листов: текущая — вытянутая медовая.
struct PageDots: View {
    let count: Int
    let current: Int

    var body: some View {
        HStack(spacing: TeleTauSpace.s150) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i == current ? TeleTauColor.accentFill : TeleTauColor.borderDefault)
                    .frame(width: i == current ? 24 : 8, height: 8)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Шаг \(current + 1) из \(count)"))
    }
}
