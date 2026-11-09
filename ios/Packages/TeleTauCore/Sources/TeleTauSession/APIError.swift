import Foundation
import TeleTauAPI
import OpenAPIRuntime

public typealias Problem = Components.Schemas.Problem

/// Ответ API с ошибкой (RFC 9457 Problem Details): клиент ветвится по `code`, неизвестный `code` — по `status`.
public struct APIProblem: Error, Sendable, Equatable {
    public let status: Int
    public let code: String?
    public let title: String?
    /// Первые ошибки полей (422) — `errors[].detail`, по-русски.
    public let fieldDetails: [String]
    /// `Retry-After`, секунд (429, 409 `request_in_progress`).
    public let retryAfter: Int?

    public init(status: Int, code: String? = nil, title: String? = nil, fieldDetails: [String] = [], retryAfter: Int? = nil) {
        self.status = status
        self.code = code
        self.title = title
        self.fieldDetails = fieldDetails
        self.retryAfter = retryAfter
    }

    init(status: Int, problem: Problem?, retryAfter: Int?) {
        self.init(
            status: status,
            code: problem?.code,
            title: problem?.title,
            fieldDetails: problem?.errors?.map(\.detail) ?? [],
            retryAfter: retryAfter
        )
    }
}

/// Ошибка вызова API для экранов: нет связи, ответ-ошибка, сессия закончилась или что-то непредвиденное.
public enum APIError: Error, Sendable, Equatable {
    /// Нет сети, таймаут, сервер недоступен.
    case offline
    case problem(APIProblem)
    /// Сессии нет или её завершил сервер (refresh отклонён) — нужно войти снова. `reason` — `code` ответа.
    case signedOut(reason: String?)
    /// Ответ не по контракту (не разобрался).
    case unexpected(String)

    public var problem: APIProblem? {
        if case .problem(let p) = self { p } else { nil }
    }

    public var isOffline: Bool { self == .offline }

    /// Ошибка любого слоя (транспорт, middleware, разбор) → APIError.
    public static func from(_ error: any Error) -> APIError {
        switch error {
        case let e as APIError:
            return e
        case let e as APIProblem:
            return .problem(e)
        case let e as SessionError:
            if case .signedOut(let reason) = e { return .signedOut(reason: reason) }
            return .offline
        case let e as ClientError:
            return from(e.underlyingError)
        case let e as URLError:
            return isNetwork(e) ? .offline : .unexpected("URLError \(e.code.rawValue)")
        case is CancellationError:
            return .offline
        case let e as DecodingError:
            return .unexpected("Ответ не по контракту: \(e)")
        default:
            let ns = error as NSError
            if ns.domain == NSURLErrorDomain { return .offline }
            return .unexpected(String(describing: error))
        }
    }

    static func isNetwork(_ e: URLError) -> Bool {
        switch e.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost,
             .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .secureConnectionFailed, .cancelled,
             .badServerResponse, .resourceUnavailable, .callIsActive:
            true
        default:
            false
        }
    }
}

/// Состояние сессии хранилища.
public enum SessionError: Error, Sendable, Equatable {
    /// Сессии нет или refresh отклонён сервером (401): `reason` — `code` ответа (`refresh_reused`, `session_revoked`…).
    case signedOut(reason: String?)
    /// Обновить токены не удалось по временной причине (нет сети, 429, 503) — сессия сохранена, можно повторить.
    case refreshUnavailable
}
