import DesignSystem
import Foundation
import TeleTauSession
import SwiftUI

extension EnvironmentValues {
    /// Адрес сайта: к относительному адресу записи (`/audio/…`) добавляется он.
    @Entry var teletauWebBase: URL?
}

/// Адрес записи произношения (`AudioClip.url`): берётся как есть; относительный путь — от адреса сайта.
/// Кнопка «Послушать» появляется, только если формат играет AVFoundation (Ogg — нет).
public enum ClipAddress {
    public static func resolve(_ raw: String, webBase: URL?) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let url: URL?
        if trimmed.hasPrefix("/") {
            guard let webBase, var parts = URLComponents(url: webBase, resolvingAgainstBaseURL: false) else { return nil }
            let path = trimmed.split(separator: "?", maxSplits: 1)
            parts.path = (parts.path.hasSuffix("/") ? String(parts.path.dropLast()) : parts.path) + String(path[0])
            parts.query = path.count > 1 ? String(path[1]) : nil
            url = parts.url
        } else {
            url = URL(string: trimmed)
        }
        guard let url, let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), SpeakPlayer.isPlayable(url) else { return nil }
        return url
    }
}

/// «Послушать» для записи из ответа API; нет записи или формат не играется — кнопки нет.
struct ClipSpeakButton: View {
    let clip: AudioClip?
    var size: SpeakButton.Size = .large
    var label = "Послушать"
    @Environment(\.teletauWebBase) private var webBase

    var body: some View {
        SpeakButton(url: clip.flatMap { ClipAddress.resolve($0.url, webBase: webBase) }, size: size, label: label)
    }
}
