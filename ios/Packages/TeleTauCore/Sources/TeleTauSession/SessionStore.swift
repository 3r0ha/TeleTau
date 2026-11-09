import Foundation
import TeleTauAPI

public typealias Me = Components.Schemas.Me
public typealias AuthSession = Components.Schemas.AuthSession

/// Пара токенов сессии (ADR 0015): access — JWT на 15 минут, refresh — одноразовый, ротируется при каждом обновлении.
public struct StoredTokens: Codable, Sendable, Equatable {
    public var accessToken: String
    public var accessTokenExpiresAt: Date
    public var refreshToken: String
    public var refreshTokenExpiresAt: Date

    public init(accessToken: String, accessTokenExpiresAt: Date, refreshToken: String, refreshTokenExpiresAt: Date) {
        self.accessToken = accessToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshToken = refreshToken
        self.refreshTokenExpiresAt = refreshTokenExpiresAt
    }

    public init(_ s: AuthSession) {
        self.init(
            accessToken: s.accessToken,
            accessTokenExpiresAt: s.accessTokenExpiresAt,
            refreshToken: s.refreshToken,
            refreshTokenExpiresAt: s.refreshTokenExpiresAt
        )
    }
}

/// Что произошло с сессией — для корневой модели приложения.
public enum SessionEvent: Sendable, Equatable {
    case signedIn(Me)
    case accountUpdated(Me)
    /// Сессия закончилась: выход ученика или отказ сервера в обновлении (`reason` — `code` ответа).
    case signedOut(reason: String?)
}

/// Обновление пары токенов: `POST /auth/refresh` (без middleware авторизации).
public typealias Refresher = @Sendable (_ refreshToken: String, _ deviceInstallId: String) async throws -> AuthSession

/// Сессия ученика на устройстве: токены и аккаунт в защищённом хранилище, single-flight обновление токенов.
///
/// Refresh-токен одноразовый (ротация, ADR 0015): два параллельных обновления одним токеном сервер сочтёт
/// повторным предъявлением и отзовёт всё семейство (`refresh_reused`). Поэтому обновление идёт строго по одному:
/// все запросы, получившие 401 или заметившие истекающий access-токен, ждут одну общую задачу обновления.
public actor SessionStore {
    enum Key {
        static let tokens = "tokens"
        static let account = "account"
        static let installId = "installId"
    }

    /// Обновлять access-токен заранее, если до конца его срока осталось меньше этого.
    public static let refreshLeeway: TimeInterval = 60

    private let secure: any SecureStore
    private let clock: @Sendable () -> Date
    private var tokens: StoredTokens?
    private var account: Me?
    private var refreshTask: Task<String, any Error>?
    private var listeners: [UUID: AsyncStream<SessionEvent>.Continuation] = [:]

    /// Идентификатор установки (`DeviceInfo.installId`): один на установку, к нему привязаны сессии и refresh.
    public nonisolated let installId: String

    /// Сколько раз ходили за новой парой токенов (для тестов single-flight).
    public private(set) var refreshCount = 0

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    public init(secure: any SecureStore, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.secure = secure
        self.clock = clock
        if let data = secure.read(Key.installId), let id = String(data: data, encoding: .utf8), UUID(uuidString: id) != nil {
            installId = id
        } else {
            let id = UUID().uuidString.lowercased()
            secure.write(Key.installId, Data(id.utf8))
            installId = id
        }
        tokens = secure.read(Key.tokens).flatMap { try? Self.decoder.decode(StoredTokens.self, from: $0) }
        account = secure.read(Key.account).flatMap { try? Self.decoder.decode(Me.self, from: $0) }
        // Refresh-токен истёк — сессии нет (новая пара не выдастся).
        if let t = tokens, t.refreshTokenExpiresAt <= clock() {
            tokens = nil
            account = nil
            secure.delete(Key.tokens)
            secure.delete(Key.account)
        }
    }

    // MARK: - Состояние

    public var hasSession: Bool { tokens != nil }
    public var currentAccount: Me? { account }
    public var currentTokens: StoredTokens? { tokens }

    public func events() -> AsyncStream<SessionEvent> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<SessionEvent>.makeStream(bufferingPolicy: .bufferingNewest(8))
        listeners[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeListener(id) }
        }
        return stream
    }

    private func removeListener(_ id: UUID) {
        listeners[id] = nil
    }

    private func emit(_ event: SessionEvent) {
        for c in listeners.values { c.yield(event) }
    }

    // MARK: - Вход и выход

    /// Новая сессия: вход по QR или выдача по одобренной заявке.
    public func adopt(_ session: AuthSession) {
        save(StoredTokens(session), account: session.account)
        emit(.signedIn(session.account))
    }

    /// Свежий аккаунт (`GET /me`, `PATCH /me`).
    public func updateAccount(_ me: Me) {
        account = me
        if let data = try? Self.encoder.encode(me) { secure.write(Key.account, data) }
        emit(.accountUpdated(me))
    }

    /// Локальный выход: токены и аккаунт стираются, идентификатор установки остаётся.
    public func clear(reason: String? = nil) {
        let had = tokens != nil
        tokens = nil
        account = nil
        secure.delete(Key.tokens)
        secure.delete(Key.account)
        refreshTask?.cancel()
        refreshTask = nil
        if had { emit(.signedOut(reason: reason)) }
    }

    private func save(_ t: StoredTokens, account me: Me?) {
        tokens = t
        if let data = try? Self.encoder.encode(t) { secure.write(Key.tokens, data) }
        if let me {
            account = me
            if let data = try? Self.encoder.encode(me) { secure.write(Key.account, data) }
        }
    }

    // MARK: - Токены

    /// Access-токен для запроса: nil — сессии нет. Истекающий токен сначала обновляется (общей задачей).
    public func accessToken(refresher: @escaping Refresher) async throws -> String? {
        guard let t = tokens else { return nil }
        if t.accessTokenExpiresAt.timeIntervalSince(clock()) > Self.refreshLeeway { return t.accessToken }
        return try await refresh(rejecting: t.accessToken, refresher: refresher)
    }

    /// Новый access-токен после 401 на токене `rejected`. Если пока шёл запрос, токен уже обновил кто-то другой, —
    /// сразу новый токен; если обновление идёт — ждём его же; иначе запускаем одно обновление на всех.
    public func refresh(rejecting rejected: String?, refresher: @escaping Refresher) async throws -> String {
        guard let t = tokens else { throw SessionError.signedOut(reason: nil) }
        if let rejected, t.accessToken != rejected { return t.accessToken }
        if let running = refreshTask { return try await running.value }
        let task = Task { try await self.performRefresh(using: t.refreshToken, refresher: refresher) }
        refreshTask = task
        return try await task.value
    }

    private func performRefresh(using refreshToken: String, refresher: Refresher) async throws -> String {
        defer { refreshTask = nil }
        refreshCount += 1
        do {
            let session = try await refresher(refreshToken, installId)
            // Пока шёл запрос, ученик мог выйти — новую пару не сохраняем.
            guard tokens?.refreshToken == refreshToken else { throw SessionError.signedOut(reason: nil) }
            save(StoredTokens(session), account: session.account)
            emit(.accountUpdated(session.account))
            return session.accessToken
        } catch {
            // Сгенерированный клиент заворачивает ошибку middleware в ClientError.
            switch APIError.from(error) {
            case .problem(let problem) where problem.status == 401:
                clear(reason: problem.code)
                throw SessionError.signedOut(reason: problem.code)
            case .signedOut(let reason):
                throw SessionError.signedOut(reason: reason)
            default:
                throw SessionError.refreshUnavailable
            }
        }
    }
}
