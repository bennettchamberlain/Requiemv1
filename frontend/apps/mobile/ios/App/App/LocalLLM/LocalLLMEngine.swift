import Foundation

/// One turn of an OpenAI-style chat request: role is "system" | "user" | "assistant".
struct ChatTurn {
  let role: String
  let text: String
}

enum LocalLLMEngineError: Error, LocalizedError {
  case notLoaded
  case invalidRequest(String)

  var errorDescription: String? {
    switch self {
    case .notLoaded: return "No model loaded"
    case .invalidRequest(let details): return "Invalid request: \(details)"
    }
  }
}

/// Wraps a single LiteRT-LM `Engine`/`Conversation` pair. A fresh `Conversation` is
/// created per chat-completion request (OpenAI's wire format sends the full history
/// each call, so `ConversationConfig.initialMessages` replays everything but the final
/// user turn, which is submitted live via `Conversation.sendMessageStream`).
actor LocalLLMEngine {
  private var engine: Engine?

  private(set) var modelPath: String?

  var isLoaded: Bool { engine != nil }

  /// Loads `modelPath`. Native init can take several seconds (per LiteRT-LM's own docs).
  func load(modelPath: String) async throws {
    unloadSync()
    let config = try EngineConfig(modelPath: modelPath, backend: .cpu())
    let newEngine = Engine(engineConfig: config)
    try await newEngine.initialize()
    self.engine = newEngine
    self.modelPath = modelPath
  }

  func unload() {
    unloadSync()
  }

  private func unloadSync() {
    engine = nil
    modelPath = nil
  }

  /// Streams the assistant's reply to `turns` as text deltas. `turns` must end with a
  /// "user" turn; everything before it (including a leading "system" turn) seeds the
  /// conversation.
  ///
  /// LiteRT-LM's streamed `Message`s are not documented as strictly delta-only across
  /// engine versions, so each emission is diffed against the running total rather than
  /// assumed to be an incremental chunk — correct whether the SDK yields deltas or
  /// cumulative text.
  func streamCompletion(turns: [ChatTurn]) throws -> AsyncThrowingStream<String, Error> {
    guard let engine else {
      throw LocalLLMEngineError.notLoaded
    }

    let systemText = turns.first(where: { $0.role == "system" })?.text
    let history = turns.filter { $0.role == "user" || $0.role == "assistant" }
    guard let last = history.last else {
      throw LocalLLMEngineError.invalidRequest("No user message in request")
    }
    guard last.role == "user" else {
      throw LocalLLMEngineError.invalidRequest("The last message must have role 'user'")
    }

    let priorMessages: [Message] = history.dropLast().map {
      Message($0.text, role: $0.role == "user" ? .user : .model)
    }
    let systemMessage = systemText.map { Message($0, role: .system) }

    return AsyncThrowingStream { continuation in
      Task {
        do {
          let conversation = try await engine.createConversation(
            with: ConversationConfig(systemMessage: systemMessage, initialMessages: priorMessages)
          )
          var previousFull = ""
          for try await message in conversation.sendMessageStream(Message(last.text)) {
            let full = message.toString
            let delta = full.hasPrefix(previousFull) ? String(full.dropFirst(previousFull.count)) : full
            previousFull = full
            if !delta.isEmpty {
              continuation.yield(delta)
            }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
    }
  }
}
