import Foundation

/// Shared configuration the native App Intents need to reach the CI-Server, read
/// straight from the Keychain that the web app already writes to.
///
/// The Capacitor app authenticates with a long-lived API key minted after login and
/// stores it via `capacitor-secure-storage-plugin`, which keeps values in the
/// Keychain under the service name `cap_sec` (the storage key becomes the account).
/// The web app additionally mirrors the configured server origin into the same store
/// (`ci.apiBaseUrl`) precisely so cookie-/WebView-less native code — like an App
/// Intent running outside the webview — can read it here. No App Group or extra
/// plugin is required: both values live in the app's default Keychain.
enum CompanionConfig {
    /// Keychain service used by `capacitor-secure-storage-plugin`.
    private static let keychainService = "cap_sec"

    /// Storage keys, kept in sync with `@ci/common` (`apiAuth.ts` / `apiBase.ts`) and
    /// `useAuth.ts`.
    private static let apiKeyAccount = "ci.apiKey"
    private static let baseUrlAccount = "ci.apiBaseUrl"

    /// The configured server origin (e.g. `https://ci-server.example.com`), or nil if
    /// the user hasn't completed the in-app `/server` setup yet.
    static var baseUrl: URL? {
        guard let raw = keychainString(forKey: baseUrlAccount)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else {
            return nil
        }

        return URL(string: raw)
    }

    /// The long-lived API key, or nil if the user isn't signed in.
    static var apiKey: String? {
        guard let key = keychainString(forKey: apiKeyAccount), !key.isEmpty else {
            return nil
        }

        return key
    }

    /// Whether there is enough configuration to make an authenticated API call.
    static var isReady: Bool {
        baseUrl != nil && apiKey != nil
    }

    private static func keychainString(forKey account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }
}

/// Errors surfaced to Siri/Shortcuts when an intent can't run.
enum CompanionIntentError: LocalizedError {
    case notConfigured
    case notSignedIn
    case requestFailed(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Open Companion and set your server address first."
        case .notSignedIn:
            return "Sign in to Companion first, then try again."
        case let .requestFailed(message):
            return message
        }
    }
}
