import Foundation
import OpenAPIRuntime

/// UUIDv7 клиента (RFC 9562): `runId` урока и `attemptId` ответа. Повтор запроса с тем же идентификатором сервер
/// не засчитывает дважды, а время в старших битах упорядочивает попытки (как `ids.ts` веба).
public enum UUIDv7 {
    public static func make(now: Date = Date()) -> String {
        var rng = SystemRandomNumberGenerator()
        var b = (0..<16).map { _ in UInt8.random(in: 0...255, using: &rng) }
        var ms = UInt64(max(0, (now.timeIntervalSince1970 * 1000).rounded(.down)))
        for i in stride(from: 5, through: 0, by: -1) {
            b[i] = UInt8(ms & 0xFF)
            ms >>= 8
        }
        b[6] = (b[6] & 0x0F) | 0x70
        b[8] = (b[8] & 0x3F) | 0x80
        let hex = b.map { String(format: "%02x", $0) }.joined()
        let parts = [0..<8, 8..<12, 12..<16, 16..<20, 20..<32].map { r in
            String(hex[hex.index(hex.startIndex, offsetBy: r.lowerBound)..<hex.index(hex.startIndex, offsetBy: r.upperBound)])
        }
        return parts.joined(separator: "-")
    }
}

/// Даты RFC 3339: сервер пишет `toISOString()` (с миллисекундами), но контракт допускает и без дробной части.
public struct FlexibleISO8601Transcoder: DateTranscoder {
    private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let plain = Date.ISO8601FormatStyle()

    public init() {}

    public func encode(_ date: Date) throws -> String {
        Self.fractional.format(date)
    }

    public func decode(_ string: String) throws -> Date {
        if let date = try? Self.fractional.parse(string) { return date }
        if let date = try? Self.plain.parse(string) { return date }
        throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Дата не в формате RFC 3339: \(string)"))
    }
}

/// Адрес API: из настроек сборки (`TeleTauAPIBaseURL` в Info.plist) или с экрана настроек для демо.
public enum ServerAddress {
    public static let defaultsKey = "teletau.api.baseURL"
    /// Адрес сайта, заданный на экране настроек (пусто — из настроек сборки или по адресу API).
    public static let webDefaultsKey = "teletau.web.baseURL"

    /// Приводит ввод к адресу API: `192.168.1.5:4000` → `http://192.168.1.5:4000`. Только http и https с хостом.
    public static func normalize(_ input: String) -> URL? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") { s = "http://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = url.host, !host.isEmpty, url.query == nil, url.fragment == nil else { return nil }
        return url
    }

    /// Адрес сайта для кабинета учителя: из настроек сборки, иначе тот же хост на порту веба (4000 → 3000).
    public static func webURL(api: URL, configured: String?) -> URL {
        if let configured, let url = normalize(configured) { return url }
        guard var parts = URLComponents(url: api, resolvingAgainstBaseURL: false) else { return api }
        if parts.port == 4000 { parts.port = 3000 }
        parts.path = ""
        return parts.url ?? api
    }
}
