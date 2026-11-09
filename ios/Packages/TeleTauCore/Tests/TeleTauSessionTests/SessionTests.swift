import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import TeleTauAPI
@testable import TeleTauSession

// Сессия ученика (ADR 0015): single-flight обновление токенов, повтор запроса после 401, отказ в обновлении,
// хранение в защищённом хранилище и разбор Problem Details. Сервер подменён транспортом в памяти.

// MARK: - Подставной сервер

final class MockServer: ClientTransport, @unchecked Sendable {
    struct Recorded: Sendable {
        let operationID: String
        let path: String
        let authorization: String?
        let body: String
    }

    typealias Handler = @Sendable (_ op: String, _ request: HTTPRequest, _ body: String) async throws -> (Int, String)

    private let lock = NSLock()
    private var log: [Recorded] = []
    private let handler: Handler

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    var requests: [Recorded] { lock.withLock { log } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        let text: String
        if let body { text = String(decoding: try await Data(collecting: body, upTo: 1 << 20), as: UTF8.self) } else { text = "" }
        lock.withLock {
            log.append(Recorded(operationID: operationID, path: request.path ?? "", authorization: request.headerFields[.authorization], body: text))
        }
        let (status, json) = try await handler(operationID, request, text)
        var fields = HTTPFields()
        fields[.contentType] = status >= 400 ? "application/problem+json" : "application/json"
        return (HTTPResponse(status: .init(code: status), headerFields: fields), json.isEmpty ? nil : HTTPBody(json))
    }
}

enum Fixture {
    static let installId = "0b1e7c9a-5d2f-4c8e-9a61-3f0d2b7e4c11"

    static func me(nickname: String = "Смелая пчела") -> String {
        """
        {"id":"7f0d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f","kind":"child","roles":["student"],"nickname":"\(nickname)",
         "uiMode":"bortnik","locale":"ru","teacherStatus":"none",
         "classes":[{"id":"1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5","title":"5 «Б»","schoolName":"Демо-школа № 1","role":"student","seatNumber":7}],
         "pendingConsents":[]}
        """
    }

    /// Ответ AuthSession; `accessIn` — через сколько секунд истекает access-токен.
    static func auth(access: String, refresh: String, accessIn: TimeInterval = 900, now: Date = Date()) -> String {
        let f = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return """
        {"accessToken":"\(access)","accessTokenExpiresAt":"\(f.format(now.addingTimeInterval(accessIn)))",
         "refreshToken":"\(refresh)","refreshTokenExpiresAt":"\(f.format(now.addingTimeInterval(86_400 * 30)))",
         "tokenType":"Bearer","account":\(me())}
        """
    }

    static let course = #"{"id":"ba-ru","contentVersion":1,"units":[]}"#

    static func problem(_ status: Int, _ code: String) -> String {
        #"{"type":"about:blank","title":"Ошибка","status":\#(status),"code":"\#(code)"}"#
    }

    static func tokens(access: String, refresh: String, accessIn: TimeInterval = 900) -> StoredTokens {
        StoredTokens(accessToken: access, accessTokenExpiresAt: Date().addingTimeInterval(accessIn),
                     refreshToken: refresh, refreshTokenExpiresAt: Date().addingTimeInterval(86_400))
    }

    static func store(with tokens: StoredTokens?) throws -> InMemorySecureStore {
        let secure = InMemorySecureStore()
        secure.write(SessionStore.Key.installId, Data(installId.utf8))
        if let tokens {
            let e = JSONEncoder()
            e.dateEncodingStrategy = .iso8601
            secure.write(SessionStore.Key.tokens, try e.encode(tokens))
        }
        return secure
    }

    static let baseURL = URL(string: "http://192.168.1.5:4000")!
}

/// Сервер с ротацией: действует только последний выданный access-токен, refresh одноразовый.
actor Rotation {
    var access = "A1"
    var refresh = "R1"
    var issued = 0

    func isValid(_ header: String?) -> Bool { header == "Bearer \(access)" }

    func rotate(presented: String) -> String? {
        guard presented == refresh else { return nil }
        issued += 1
        access = "A\(issued + 1)"
        refresh = "R\(issued + 1)"
        return Fixture.auth(access: access, refresh: refresh)
    }
}

@Suite("Сессия: токены и обновление")
struct SessionTests {
    @Test("Параллельные запросы с отклонённым токеном обновляют его один раз и повторяются")
    func singleFlightRefresh() async throws {
        let rotation = Rotation()
        let server = MockServer { op, request, body in
            if op == "refreshSession" {
                try await Task.sleep(for: .milliseconds(50))
                let presented = try JSONDecoder().decode([String: String].self, from: Data(body.utf8))
                #expect(presented["deviceInstallId"] == Fixture.installId)
                guard let auth = await rotation.rotate(presented: presented["refreshToken"] ?? "") else {
                    return (401, Fixture.problem(401, "refresh_reused"))
                }
                return (200, auth)
            }
            // Сервер уже считает A1 отозванным: access A1 по часам клиента ещё действует.
            guard await rotation.access != "A1", await rotation.isValid(request.headerFields[.authorization]) else {
                return (401, Fixture.problem(401, "token_expired"))
            }
            return (200, Fixture.course)
        }
        let secure = try Fixture.store(with: Fixture.tokens(access: "A1", refresh: "R1"))
        let session = SessionStore(secure: secure)
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        let results = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<8 { group.addTask { try await client.course().id } }
            return try await group.reduce(into: [String]()) { $0.append($1) }
        }

        #expect(results.count == 8 && results.allSatisfy { $0 == "ba-ru" })
        #expect(server.requests.filter { $0.operationID == "refreshSession" }.count == 1, "refresh должен быть один")
        #expect(await session.refreshCount == 1)
        #expect(await session.currentTokens?.accessToken == "A2")
        #expect(await session.currentTokens?.refreshToken == "R2")
        // Повторы — с новым токеном; refresh без заголовка авторизации.
        let retried = server.requests.filter { $0.operationID == "getCourse" && $0.authorization == "Bearer A2" }
        #expect(retried.count == 8)
        #expect(server.requests.first { $0.operationID == "refreshSession" }?.authorization == nil)
        // Новая пара сохранена в защищённом хранилище: после перезапуска сессия та же.
        let restored = SessionStore(secure: secure)
        #expect(await restored.currentTokens?.refreshToken == "R2")
        #expect(restored.installId == Fixture.installId)
    }

    @Test("Истекающий access-токен обновляется до запроса, без лишнего 401")
    func proactiveRefresh() async throws {
        let server = MockServer { op, request, _ in
            if op == "refreshSession" { return (200, Fixture.auth(access: "A2", refresh: "R2")) }
            return request.headerFields[.authorization] == "Bearer A2" ? (200, Fixture.course) : (401, Fixture.problem(401, "token_expired"))
        }
        let session = SessionStore(secure: try Fixture.store(with: Fixture.tokens(access: "A1", refresh: "R1", accessIn: 10)))
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        _ = try await client.course()

        #expect(server.requests.map(\.operationID) == ["refreshSession", "getCourse"])
        #expect(server.requests.last?.authorization == "Bearer A2")
    }

    @Test("Отказ в обновлении (401) завершает сессию: токены стёрты, экран входа узнаёт причину")
    func refreshRejectedSignsOut() async throws {
        let server = MockServer { op, _, _ in
            op == "refreshSession" ? (401, Fixture.problem(401, "refresh_reused")) : (401, Fixture.problem(401, "token_expired"))
        }
        let secure = try Fixture.store(with: Fixture.tokens(access: "A1", refresh: "R1"))
        let session = SessionStore(secure: secure)
        let events = await session.events()
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        await #expect(throws: APIError.signedOut(reason: "refresh_reused")) {
            _ = try await client.course()
        }
        #expect(await session.hasSession == false)
        #expect(secure.read(SessionStore.Key.tokens) == nil)
        #expect(secure.read(SessionStore.Key.installId) != nil, "идентификатор установки остаётся")
        var iterator = events.makeAsyncIterator()
        #expect(await iterator.next() == .signedOut(reason: "refresh_reused"))
    }

    @Test("Временный сбой обновления (503) не стирает сессию")
    func transientRefreshFailureKeepsSession() async throws {
        let server = MockServer { op, _, _ in
            op == "refreshSession" ? (503, Fixture.problem(503, "service_unavailable")) : (401, Fixture.problem(401, "token_expired"))
        }
        let session = SessionStore(secure: try Fixture.store(with: Fixture.tokens(access: "A1", refresh: "R1")))
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        await #expect(throws: APIError.offline) {
            _ = try await client.course()
        }
        #expect(await session.currentTokens?.refreshToken == "R1")
    }

    @Test("Вход по QR: устройство iOS в запросе, сессия и аккаунт сохраняются")
    func qrLoginAdoptsSession() async throws {
        let server = MockServer { op, _, body in
            #expect(op == "loginWithQrCard")
            let json = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any]
            let device = json?["device"] as? [String: Any]
            #expect(json?["payload"] as? String == "TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V")
            #expect(device?["platform"] as? String == "ios")
            #expect(device?["installId"] as? String == Fixture.installId)
            return (200, Fixture.auth(access: "A1", refresh: "R1"))
        }
        let secure = try Fixture.store(with: nil)
        let session = SessionStore(secure: secure)
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        let me = try await client.loginWithQr(payload: "TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V")

        #expect(me.nickname == "Смелая пчела")
        #expect(me.uiMode == .bortnik)
        #expect(server.requests.first?.authorization == nil, "вход — без токена")
        let restored = SessionStore(secure: secure)
        #expect(await restored.currentAccount?.classes.first?.title == "5 «Б»")
        #expect(await restored.currentTokens?.accessToken == "A1")
    }

    @Test("Problem Details → APIProblem с code и Retry-After; нет связи → offline")
    func problemsAndOffline() async throws {
        let server = MockServer { op, _, _ in
            switch op {
            case "requestClassCodeLogin": return (404, Fixture.problem(404, "class_code_not_found"))
            default: throw URLError(.notConnectedToInternet)
            }
        }
        let session = SessionStore(secure: try Fixture.store(with: nil))
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        await #expect(throws: APIError.problem(APIProblem(status: 404, code: "class_code_not_found", title: "Ошибка"))) {
            _ = try await client.requestClassCode(code: "K7Q4MZ", nicknameId: "adj.noun:1")
        }
        await #expect(throws: APIError.offline) {
            _ = try await client.loginWithQr(payload: "TT1")
        }
    }

    @Test("Опрос заявки по коду класса: X-Poll-Token и X-Device-Install-Id, выданная сессия сохраняется")
    func classCodePoll() async throws {
        let server = MockServer { _, request, _ in
            #expect(request.headerFields[HTTPField.Name("X-Poll-Token")!] == "poll-token-0123456789")
            #expect(request.headerFields[HTTPField.Name("X-Device-Install-Id")!] == Fixture.installId)
            let f = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
            return (200, """
            {"requestId":"5b8c2a10-0f3e-4c1a-9d2b-7e6f5a4b3c21","status":"approved","expiresAt":"\(f.format(Date().addingTimeInterval(600)))",
             "pollIntervalSeconds":3,"session":\(Fixture.auth(access: "A9", refresh: "R9"))}
            """)
        }
        let session = SessionStore(secure: try Fixture.store(with: nil))
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        let status = try await client.pollClassCode(requestId: "5b8c2a10-0f3e-4c1a-9d2b-7e6f5a4b3c21", pollToken: "poll-token-0123456789")

        #expect(status.status == .approved)
        #expect(await session.currentTokens?.accessToken == "A9")
        #expect(server.requests.first?.path == "/api/v1/auth/class-code/5b8c2a10-0f3e-4c1a-9d2b-7e6f5a4b3c21")
    }

    @Test("Выход: сервер отзывает сессию, локально всё стёрто")
    func logoutClears() async throws {
        let server = MockServer { op, request, _ in
            #expect(op == "logout")
            #expect(request.headerFields[.authorization] == "Bearer A1")
            return (204, "")
        }
        let secure = try Fixture.store(with: Fixture.tokens(access: "A1", refresh: "R1"))
        let session = SessionStore(secure: secure)
        let client = TeleTauClient(baseURL: Fixture.baseURL, session: session, transport: server)

        await client.logout()

        #expect(await session.hasSession == false)
        #expect(secure.read(SessionStore.Key.tokens) == nil)
    }
}

@Suite("Сессия: служебное")
struct SessionSupportTests {
    @Test("UUIDv7: версия 7, вариант RFC 9562, время в старших 48 битах")
    func uuidV7() throws {
        let now = Date(timeIntervalSince1970: 1_793_750_400.123)
        let id = UUIDv7.make(now: now)
        #expect(UUID(uuidString: id) != nil)
        let hex = id.replacingOccurrences(of: "-", with: "")
        #expect(hex[hex.index(hex.startIndex, offsetBy: 12)] == "7")
        #expect("89ab".contains(hex[hex.index(hex.startIndex, offsetBy: 16)]))
        #expect(UInt64(hex.prefix(12), radix: 16) == 1_793_750_400_123)
        #expect(UUIDv7.make(now: now) != id)
    }

    @Test("Даты RFC 3339 — с миллисекундами и без")
    func dates() throws {
        let t = FlexibleISO8601Transcoder()
        #expect(try t.decode("2026-11-04T10:00:00.250Z").timeIntervalSince1970 == 1_793_786_400.25)
        #expect(try t.decode("2026-11-04T10:00:00Z").timeIntervalSince1970 == 1_793_786_400)
        #expect(throws: (any Error).self) { try t.decode("04.11.2026") }
    }

    @Test("Адрес сервера: IP с портом, схема по умолчанию, только http(s)")
    func serverAddress() {
        #expect(ServerAddress.normalize(" 192.168.1.5:4000/ ")?.absoluteString == "http://192.168.1.5:4000")
        #expect(ServerAddress.normalize("https://api.teletau.study")?.absoluteString == "https://api.teletau.study")
        #expect(ServerAddress.normalize("ftp://x") == nil)
        #expect(ServerAddress.normalize("") == nil)
        #expect(ServerAddress.webURL(api: URL(string: "http://192.168.1.5:4000")!, configured: nil).absoluteString == "http://192.168.1.5:3000")
        #expect(ServerAddress.webURL(api: URL(string: "http://192.168.1.5:4000")!, configured: "https://teletau.study").absoluteString == "https://teletau.study")
    }

    @Test("Keychain: запись, чтение, удаление (если Keychain доступен процессу тестов)")
    func keychainRoundTrip() throws {
        let store = KeychainStore(service: "ru.teletau.tests.\(UUID().uuidString)")
        let status = store.status(writing: "k", Data("v".utf8))
        // Неподписанному тестовому процессу macOS может не дать Keychain — тогда проверять нечего.
        guard status == errSecSuccess else {
            print("Keychain недоступен тестовому процессу: OSStatus \(status)")
            return
        }
        #expect(store.read("k") == Data("v".utf8))
        #expect(store.write("k", Data("w".utf8)))
        #expect(store.read("k") == Data("w".utf8))
        store.delete("k")
        #expect(store.read("k") == nil)
    }
}
