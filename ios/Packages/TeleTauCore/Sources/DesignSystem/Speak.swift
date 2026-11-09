import AVFoundation
import SwiftUI

/// Воспроизведение записей произношения (AVFoundation): одна запись за раз, грузится только по нажатию.
/// Не загрузилась или кончилась — кнопка просто перестаёт «звучать» (ребёнку не показываем технических ошибок).
@MainActor
@Observable
public final class SpeakPlayer {
    public static let shared = SpeakPlayer()

    public private(set) var playing: URL?
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var observers: [any NSObjectProtocol] = []

    /// Форматы, которые AVFoundation играет на iOS. Ogg (Vorbis, Opus) и WebM — нет: для них кнопки не будет.
    public nonisolated static let playableExtensions: Set<String> = ["m4a", "mp4", "aac", "mp3", "wav", "caf", "aif", "aiff"]

    public nonisolated static func isPlayable(_ url: URL) -> Bool {
        playableExtensions.contains(url.pathExtension.lowercased())
    }

    public func toggle(_ url: URL) {
        if playing == url { stop(); return }
        stop()
        #if os(iOS)
        // Запись звучит и при выключенном звуке звонка: ученик сам нажал «Послушать».
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        let item = AVPlayerItem(url: url)
        let center = NotificationCenter.default
        for name in [AVPlayerItem.didPlayToEndTimeNotification, AVPlayerItem.failedToPlayToEndTimeNotification] {
            observers.append(center.addObserver(forName: name, object: item, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.stop() }
            })
        }
        let player = AVPlayer(playerItem: item)
        self.player = player
        playing = url
        player.play()
    }

    public func stop() {
        player?.pause()
        player = nil
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers = []
        playing = nil
    }
}

/// «Послушать» (prototype `.speak`): медовая кнопка со значком динамика — крупная на карточке слова, мягкая маленькая
/// в листе ответа и в словаре. Без записи (`url == nil`) кнопки нет.
public struct SpeakButton: View {
    /// `large` — медовая на карточке слова, `small` — мягкая в строке словаря, `sheet` — белая на цветном листе ответа.
    public enum Size: Sendable { case large, small, sheet }

    let url: URL?
    let size: Size
    let label: String
    @State private var player = SpeakPlayer.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.teletauMode) private var mode

    public init(url: URL?, size: Size = .large, label: String = "Послушать") {
        self.url = url
        self.size = size
        self.label = label
    }

    public var body: some View {
        if let url {
            let playing = player.playing == url
            let large = size == .large
            let side = large ? max(48, mode.touchTarget) : mode.touchTarget
            Button { player.toggle(url) } label: {
                IconView(.speakerHigh, size: large ? TeleTauSize.iconLarge : TeleTauSize.icon)
                    .scaleEffect(playing && !reduceMotion ? 1.12 : 1)
                    .animation(reduceMotion ? nil : .easeInOut(duration: TeleTauDuration.breath / 2).looping(playing), value: playing)
                    .foregroundStyle(large ? TeleTauColor.accentOn : TeleTauColor.accentText)
                    .frame(width: side, height: side)
                    .background(large ? TeleTauColor.accentFill : size == .sheet ? TeleTauColor.surface : TeleTauColor.accentSoft, in: RoundedRectangle(cornerRadius: TeleTauRadius.iconButton, style: .continuous))
                    .background {
                        if large {
                            RoundedRectangle(cornerRadius: TeleTauRadius.iconButton, style: .continuous)
                                .fill(TeleTauColor.accentLip).offset(y: TeleTauSize.lipSmall)
                        }
                    }
                    .padding(.bottom, large ? TeleTauSize.lipSmall : 0)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(label))
            .accessibilityAddTraits(playing ? [.isSelected, .startsMediaSession] : [.startsMediaSession])
        }
    }
}

private extension Animation {
    /// Пока играет — «звучит» по кругу; остановилось — один короткий шаг назад.
    func looping(_ active: Bool) -> Animation {
        active ? repeatForever(autoreverses: true) : self
    }
}
