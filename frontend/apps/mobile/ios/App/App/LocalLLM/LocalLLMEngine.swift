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
  private var activeConversation: Conversation?

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
    activeConversation = nil
    unloadSync()
  }

  /// Cancels the in-flight generation, if any. Safe to call with nothing in flight.
  func cancel() {
    try? activeConversation?.cancel()
    activeConversation = nil
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
  func streamCompletion(turns: [ChatTurn], tools: [any Tool] = []) throws -> AsyncThrowingStream<String, Error> {
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
    // With tools attached the model needs to be told what it is for, or a 1B model will happily
    // answer from its own weights instead of calling anything. Scoped narrowly on purpose: the
    // disconnected-mode design's explicit non-goal is "a general-purpose local chatbot".
    let systemMessage =
      systemText.map { Message($0, role: .system) }
      ?? (tools.isEmpty ? nil : Message(Self.toolSystemInstruction, role: .system))

    return AsyncThrowingStream { continuation in
      Task {
        do {
          // Tools are fixed when the conversation is created — LiteRT-LM captures the ToolManager in
          // the native handle, so they cannot be attached per message.
          let conversation = try await engine.createConversation(
            with: ConversationConfig(
              systemMessage: systemMessage, initialMessages: priorMessages, tools: tools)
          )
          await self.setActiveConversation(conversation)
          defer { Task { await self.setActiveConversation(nil) } }
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

  private func setActiveConversation(_ conversation: Conversation?) {
    activeConversation = conversation
  }

  private static let toolSystemInstruction =
    "You are Companion, answering questions about the user's own memory on their device. "
    + "Use the provided tools to look things up rather than guessing, and cite what you found. "
    + "If a tool reports an error or says an action must be confirmed on the appliance, tell the "
    + "user plainly instead of pretending it succeeded."
}
