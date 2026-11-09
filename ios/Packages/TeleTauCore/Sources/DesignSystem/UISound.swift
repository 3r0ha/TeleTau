import AVFoundation
import Foundation

/// Звуки интерфейса ученика (docs/05 §9): короткие ноты, синтезированные `AVAudioEngine`, — без файлов (как `sound.ts`
/// веба). Звучат, только если ученик не выключил их в профиле («Звуки»), и молчат при беззвучном режиме iPhone
/// (категория `ambient`); пока играет запись носителя («Послушать»), звук интерфейса не включается.
@MainActor
public final class UISound {
    public static let shared = UISound()
    public static let defaultsKey = "teletau.sounds"

    public enum Name: Sendable {
        case tap, correct, almost, wrong, voted, newWord, complete, streak, levelUp
    }

    /// Включены ли звуки на этом устройстве (по умолчанию — да).
    public var enabled: Bool {
        get { UserDefaults.standard.object(forKey: Self.defaultsKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: Self.defaultsKey) }
    }

    private var engine: AVAudioEngine?
    private var node: AVAudioPlayerNode?
    private let rate = 44_100.0

    public func play(_ name: Name) {
        guard enabled, SpeakPlayer.shared.playing == nil, let buffer = render(Self.notes(name)) else { return }
        #if os(iOS)
        // ambient: уважает беззвучный режим и не прерывает музыку на устройстве.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        #endif
        guard let (engine, node) = ready() else { return }
        if !engine.isRunning { try? engine.start() }
        guard engine.isRunning else { return }
        node.scheduleBuffer(buffer, at: nil, options: .interrupts)
        if !node.isPlaying { node.play() }
    }

    private func ready() -> (AVAudioEngine, AVAudioPlayerNode)? {
        if let engine, let node { return (engine, node) }
        let engine = AVAudioEngine()
        let node = AVAudioPlayerNode()
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else { return nil }
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        self.engine = engine
        self.node = node
        return (engine, node)
    }

    struct Note {
        var f: Double
        var at: Double
        var dur: Double
        var gain: Double
        var triangle = false
        /// Скользнуть к частоте к концу ноты.
        var to: Double?
        /// Обертон октавой выше: «деревянный» тембр, ближе к кураю.
        var overtone: Double = 0
        /// Срез высоких частот, Гц: глухой тон.
        var lowpass: Double?
    }

    private static let c5 = 523.25, e5 = 659.25, g5 = 783.99, a5 = 880.0, b5 = 987.77, c6 = 1046.5, d6 = 1174.66, e6 = 1318.51, g4 = 392.0

    /// Ноты — как `SOUNDS` веба.
    static func notes(_ name: Name) -> [Note] {
        switch name {
        case .tap: [Note(f: 620, at: 0, dur: 0.07, gain: 0.07, to: 380)]
        case .correct: [Note(f: e5, at: 0, dur: 0.14, gain: 0.16, overtone: 0.25), Note(f: b5, at: 0.09, dur: 0.34, gain: 0.16, overtone: 0.25)]
        case .almost: [Note(f: e5, at: 0, dur: 0.14, gain: 0.13, overtone: 0.2), Note(f: g5, at: 0.1, dur: 0.3, gain: 0.13, overtone: 0.2)]
        case .wrong: [Note(f: 233.08, at: 0, dur: 0.16, gain: 0.2, triangle: true, lowpass: 900), Note(f: 185, at: 0.13, dur: 0.3, gain: 0.2, triangle: true, lowpass: 700)]
        case .voted: [Note(f: c6, at: 0, dur: 0.42, gain: 0.09), Note(f: e6, at: 0.03, dur: 0.42, gain: 0.07)]
        case .newWord: [Note(f: g5, at: 0, dur: 0.24, gain: 0.06), Note(f: c6, at: 0.09, dur: 0.42, gain: 0.05)]
        case .complete: [
            Note(f: c5, at: 0, dur: 0.16, gain: 0.13, overtone: 0.2), Note(f: e5, at: 0.11, dur: 0.16, gain: 0.13, overtone: 0.2),
            Note(f: g5, at: 0.22, dur: 0.16, gain: 0.13, overtone: 0.2), Note(f: c6, at: 0.33, dur: 0.7, gain: 0.14, overtone: 0.2),
            Note(f: g5, at: 0.33, dur: 0.7, gain: 0.06), Note(f: e5, at: 0.33, dur: 0.7, gain: 0.05),
        ]
        case .streak: [
            Note(f: g4, at: 0, dur: 0.18, gain: 0.12, overtone: 0.25), Note(f: c5, at: 0.12, dur: 0.18, gain: 0.12, overtone: 0.25),
            Note(f: e5, at: 0.24, dur: 0.6, gain: 0.13, overtone: 0.25), Note(f: g5, at: 0.24, dur: 0.6, gain: 0.07),
        ]
        case .levelUp: [
            Note(f: g5, at: 0, dur: 0.12, gain: 0.12, overtone: 0.25), Note(f: g5, at: 0.13, dur: 0.12, gain: 0.12, overtone: 0.25),
            Note(f: c6, at: 0.26, dur: 0.2, gain: 0.13, overtone: 0.25), Note(f: a5, at: 0.46, dur: 0.12, gain: 0.11, overtone: 0.25),
            Note(f: d6, at: 0.58, dur: 0.18, gain: 0.12, overtone: 0.25), Note(f: e6, at: 0.76, dur: 0.8, gain: 0.12, overtone: 0.2),
            Note(f: c6, at: 0.76, dur: 0.8, gain: 0.06),
        ]
        }
    }

    /// Сводит ноты в один буфер: огибающая — быстрая атака и экспоненциальный спад, мягкое ограничение суммы.
    func render(_ notes: [Note]) -> AVAudioPCMBuffer? {
        let total = (notes.map { $0.at + $0.dur }.max() ?? 0) + 0.05
        let frames = AVAudioFrameCount(total * rate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let out = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = frames
        for i in 0..<Int(frames) { out[i] = 0 }
        for n in notes {
            let start = Int(n.at * rate), count = Int(n.dur * rate)
            let attack = 0.012
            var phase = 0.0, filtered = 0.0
            let alpha = n.lowpass.map { 1 - exp(-2 * .pi * $0 / rate) } ?? 1
            for k in 0..<count where start + k < Int(frames) {
                let t = Double(k) / rate
                let freq = n.to.map { n.f + ($0 - n.f) * t / n.dur } ?? n.f
                phase += 2 * .pi * freq / rate
                let env = t < attack ? n.gain * t / attack : n.gain * pow(0.0001 / n.gain, (t - attack) / max(0.001, n.dur - attack))
                var s = n.triangle ? 2 / .pi * asin(sin(phase)) : sin(phase)
                s += n.overtone * sin(2 * phase)
                filtered += alpha * (s - filtered)
                out[start + k] += Float(filtered * env)
            }
        }
        for i in 0..<Int(frames) { out[i] = Float(tanh(Double(out[i]) * 1.2)) * 0.9 }
        return buffer
    }
}
