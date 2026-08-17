import Foundation

/// Binds CI's published intents to LiteRT-LM's tool calling — the iOS half of the on-device agent
/// harness, and the platform where the binding has to be written by hand.
///
/// **Why iOS looks different from Android.** LiteRT-LM's Swift `Tool` is a `Decodable` protocol
/// whose JSON Schema is produced by `Mirror`-reflecting compile-time `@ToolParam` properties
/// (`swift/Tool.swift`), and the Swift surface has no `OpenApiTool` equivalent — verified against
/// the vendored source: 18 public types, one tool protocol, no schema-string entry point. Android's
/// `OpenApiTool` *does* take a runtime schema string, so there one adapter covers every intent the
/// appliance publishes. Here each intent needs a struct, and a new server-side intent needs an app
/// release to become callable. That asymmetry is structural, not an oversight.
///
/// **What is still shared.** Both platforms read the same catalog and obey the same server-computed
/// `dispatch` ruling; neither re-derives the policy. Only the binding differs.
///
/// **Why the dependencies are static.** `ToolManager` stores only the *metatype* and constructs a
/// fresh instance per call ("These instances are used only for schema generation. Execution uses new
/// instances." — `swift/ToolManager.swift`), and `Tool: Decodable` + required `init()` means a
/// stored client property would break the synthesized conformance. So `run()` reaches the client
/// through this enum rather than through injection.
enum CompanionToolContext {
  /// Set by `LocalLLMPlugin.configureIntentTools`; nil disables tool calling entirely.
  static var client: CompanionIntentClient?

  /// The server's ruling per executable tool name, refreshed with the catalog.
  static var rulings: [String: DispatchRuling] = [:]

  /// Runs an intent after re-checking the server's ruling.
  ///
  /// The re-check is not redundant with registration: registration and invocation are separated by
  /// the whole lifetime of a loaded model, and this is the last chokepoint before a destructive or
  /// third-party-touching call would actually leave the device.
  static func execute(_ toolName: String, arguments: [String: Any]) async -> String {
    guard let ruling = rulings[toolName], ruling.isExecutable else {
      return errorPayload(rulings[toolName]?.explanation ?? "\"\(toolName)\" may not run on this device")
    }
    guard let client else {
      return errorPayload("Companion is not connected to an appliance right now")
    }

    do {
      return try await client.callTool(toolName, arguments: arguments)
    } catch {
      // Returned as content, not thrown: the model can then tell the user what failed or try a
      // different intent, whereas a thrown error aborts the whole generation.
      return errorPayload(error.localizedDescription)
    }
  }

  /// Refreshes the catalog and reports which of the known tools the appliance says may run here.
  ///
  /// Returns an empty list rather than throwing when the catalog can't be read: a model answering
  /// from its own weights is a worse assistant but still an assistant, whereas failing the load
  /// because the appliance is unreachable would make the offline tier depend on being online — the
  /// exact failure the on-device path exists to avoid.
  static func refreshRulings() async -> [any Tool] {
    guard let client else { return [] }

    do {
      let manifest = try await client.fetchManifest()

      rulings = Dictionary(
        manifest.intents.compactMap { intent in
          intent.dispatch.map { (intent.tool, $0) }
        },
        uniquingKeysWith: { first, _ in first })

      if manifest.tier == nil {
        // Pre-1.2.0 appliance: it ignored `?tier=local`, so no rulings came back and every tool
        // will refuse. Say so — silently toolless is indistinguishable from "no intents exist".
        NSLog(
          "[LocalLLM] Appliance returned no per-tier dispatch rulings (manifest %@); "
            + "no tools will be offered. Upgrade CI-Server to 1.2.0+ for on-device tool calling.",
          manifest.version)
      }

      return allTools.filter { rulings[type(of: $0).name]?.isExecutable == true }
    } catch {
      NSLog("[LocalLLM] Intent catalog unavailable; the local model will run without tools: %@",
            error.localizedDescription)

      return []
    }
  }

  /// Every intent this app knows how to expose. Kept in sync with the appliance by hand — see the
  /// type comment for why iOS cannot generate these.
  static var allTools: [any Tool] {
    [SearchMemoryTool(), RecallMemoryTool(), FindPeopleTool(), RememberTool()]
  }

  /// The subset the appliance's last ruling says may run here. Empty when tools are disabled, the
  /// catalog was unreachable, or the appliance predates the tier-aware manifest.
  static func executableTools() -> [any Tool] {
    guard client != nil else { return [] }

    return allTools.filter { rulings[type(of: $0).name]?.isExecutable == true }
  }

  /// Drops the configured appliance and every cached ruling.
  static func disable() {
    client = nil
    rulings = [:]
  }

  static func errorPayload(_ message: String) -> String {
    let payload = ["error": message]
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()

    return String(decoding: data, as: UTF8.self)
  }
}

// MARK: - Tools
//
// `static let name` is already snake_case so it survives LiteRT-LM's camelCase→snake_case
// conversion (`ExperimentalFlags.convertCamelToSnakeCaseInToolDescription`, on by default) unchanged
// — these names must match the manifest's `tool` field exactly, since that is what MCP dispatches on.

/// `knowledge.search` — full-text search across the user's memory.
struct SearchMemoryTool: Tool {
  static let name = "knowledge_search"
  static let description = "Search the user's own memory, notes, messages and documents for a phrase."

  @ToolParam(description: "What to search for, in the user's own words")
  var query: String

  func run() async throws -> Any {
    await CompanionToolContext.execute(Self.name, arguments: ["query": query])
  }
}

/// `memory.recall` — recall what happened, optionally bounded by time.
struct RecallMemoryTool: Tool {
  static let name = "memory_recall"
  static let description =
    "Recall what the user did, saw or discussed, optionally within a date range. Prefer this over guessing."

  @ToolParam(description: "What to recall, in the user's own words")
  var query: String

  @ToolParam(description: "Optional earliest date to consider, ISO-8601 (e.g. 2026-01-31)")
  var startDate: String?

  @ToolParam(description: "Optional latest date to consider, ISO-8601 (e.g. 2026-02-28)")
  var endDate: String?

  func run() async throws -> Any {
    var arguments: [String: Any] = ["query": query]
    // Omitted rather than sent as null: the appliance validates against the intent's JSON Schema,
    // and an explicit null is not the same as an absent optional there.
    if let startDate { arguments["startDate"] = startDate }
    if let endDate { arguments["endDate"] = endDate }

    return await CompanionToolContext.execute(Self.name, arguments: arguments)
  }
}

/// `people.find` — look someone up.
struct FindPeopleTool: Tool {
  static let name = "people_find"
  static let description = "Find a person the user knows, and what the user knows about them."

  @ToolParam(description: "The person's name, or a description of them")
  var query: String

  func run() async throws -> Any {
    await CompanionToolContext.execute(Self.name, arguments: ["query": query])
  }
}

/// `memory.remember` — write a new note. Non-destructive, so the local tier may run it.
struct RememberTool: Tool {
  static let name = "memory_remember"
  static let description = "Save something to the user's memory so it can be recalled later."

  @ToolParam(description: "The text to remember, in the user's own words")
  var content: String

  func run() async throws -> Any {
    await CompanionToolContext.execute(Self.name, arguments: ["content": content])
  }
}
