import Foundation
import HTTPTypes
import TeleTauAPI
import OpenAPIRuntime

/// Авторизация запросов: `Authorization: Bearer <access>`; на 401 — одно общее обновление токенов
/// (`SessionStore.refresh`) и один повтор запроса с новым токеном.
struct AuthMiddleware: ClientMiddleware {
    let store: SessionStore
    let refresher: Refresher

    /// Операции без токена (`security: []` в контракте).
    static let anonymous: Set<String> = [
        "loginWithQrCard", "requestClassCodeLogin", "getClassCodeLoginStatus", "refreshSession", "createSelfLearner", "loginWithLoginCard",
    ]

    /// Тело запроса небольшое (JSON до 64 КБ по контракту) — собираем его, чтобы повторить после обновления токена.
    static let maxBody = 256 * 1024

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        if Self.anonymous.contains(operationID) { return try await next(request, body, baseURL) }
        let bytes: Data?
        if let body { bytes = try await Data(collecting: body, upTo: Self.maxBody) } else { bytes = nil }

        @Sendable func send(_ token: String?) async throws -> (HTTPResponse, HTTPBody?) {
            var authorized = request
            if let token { authorized.headerFields[.authorization] = "Bearer \(token)" }
            return try await next(authorized, bytes.map { HTTPBody($0) }, baseURL)
        }

        let token = try await store.accessToken(refresher: refresher)
        let first = try await send(token)
        guard first.0.status == .unauthorized, let token else { return first }
        // Сервер отклонил обновление — сессия закончилась: SessionError.signedOut уходит наверх с причиной.
        let fresh = try await store.refresh(rejecting: token, refresher: refresher)
        return try await send(fresh)
    }
}

/// Ответ не 2xx → `APIProblem` (RFC 9457): экраны ветвятся по `code`, а не по случаю перечисления операции.
struct ProblemMiddleware: ClientMiddleware {
    static let maxBody = 64 * 1024

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        guard !(200..<300).contains(response.status.code) else { return (response, responseBody) }
        var problem: Problem?
        if let responseBody, let data = try? await Data(collecting: responseBody, upTo: Self.maxBody) {
            problem = try? JSONDecoder().decode(Problem.self, from: data)
        }
        let retryAfter = response.headerFields[.retryAfter].flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        throw APIProblem(status: response.status.code, problem: problem, retryAfter: retryAfter)
    }
}
