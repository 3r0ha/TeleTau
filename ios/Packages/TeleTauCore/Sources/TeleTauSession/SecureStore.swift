import Foundation
import Security

/// Хранилище секретов сессии: access- и refresh-токены, идентификатор установки, аккаунт (ADR 0015).
/// В приложении — Keychain; в тестах и превью — память.
public protocol SecureStore: Sendable {
    func read(_ key: String) -> Data?
    @discardableResult func write(_ key: String, _ data: Data) -> Bool
    func delete(_ key: String)
}

/// Keychain: `kSecClassGenericPassword`, доступ — после первой разблокировки и только на этом устройстве
/// (в резервную копию и на другое устройство токены не переезжают).
public struct KeychainStore: SecureStore {
    public let service: String

    public init(service: String = "ru.teletau.app.session") {
        self.service = service
    }

    private func query(_ key: String) -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: key]
    }

    public func read(_ key: String) -> Data? {
        var q = query(key)
        q[kSecReturnData] = true
        q[kSecMatchLimit] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    @discardableResult
    public func write(_ key: String, _ data: Data) -> Bool {
        status(writing: key, data) == errSecSuccess
    }

    /// Код результата записи — для тестов (на macOS без подписи Keychain может быть недоступен).
    public func status(writing key: String, _ data: Data) -> OSStatus {
        let update: [CFString: Any] = [kSecValueData: data]
        let found = SecItemUpdate(query(key) as CFDictionary, update as CFDictionary)
        if found != errSecItemNotFound { return found }
        var add = query(key)
        add[kSecValueData] = data
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil)
    }

    public func delete(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}

/// Хранилище в памяти: тесты, превью, рендер экранов.
public final class InMemorySecureStore: SecureStore, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: Data]

    public init(_ items: [String: Data] = [:]) {
        self.items = items
    }

    public func read(_ key: String) -> Data? {
        lock.withLock { items[key] }
    }

    @discardableResult
    public func write(_ key: String, _ data: Data) -> Bool {
        lock.withLock { items[key] = data }
        return true
    }

    public func delete(_ key: String) {
        lock.withLock { _ = items.removeValue(forKey: key) }
    }

    public var keys: [String] {
        lock.withLock { Array(items.keys).sorted() }
    }
}
