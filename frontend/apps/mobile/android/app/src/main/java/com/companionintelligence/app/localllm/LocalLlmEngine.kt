package com.companionintelligence.app.localllm

import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext

/** One turn of an OpenAI-style chat request: role is "system" | "user" | "assistant". */
data class ChatTurn(val role: String, val text: String)

/**
 * Wraps a single LiteRT-LM [Engine]/[Conversation] pair. A fresh [Conversation] is created
 * per chat-completion request (OpenAI's wire format sends the full history each call, so
 * [ConversationConfig.initialMessages] replays everything but the final user turn, which is
 * submitted live via [Conversation.sendMessageAsync]).
 */
class LocalLlmEngine {
  @Volatile private var engine: Engine? = null

  @Volatile
  var modelPath: String? = null
    private set

  val isLoaded: Boolean
    get() = engine != null

  /** Loads [modelPath] on a background dispatcher — native init can take several seconds. */
  suspend fun load(modelPath: String) =
    withContext(Dispatchers.IO) {
      unloadBlocking()
      val config =
        EngineConfig(
          modelPath = modelPath,
          backend = Backend.CPU(),
          visionBackend = null,
          audioBackend = null,
          maxNumTokens = null,
          maxNumImages = null,
          cacheDir = null,
        )
      val newEngine = Engine(config)
      newEngine.initialize()
      engine = newEngine
      this@LocalLlmEngine.modelPath = modelPath
    }

  suspend fun unload() = withContext(Dispatchers.IO) { unloadBlocking() }

  private fun unloadBlocking() {
    engine?.close()
    engine = null
    modelPath = null
  }

  /**
   * Streams the assistant's reply to [turns] as text deltas. [turns] must end with a "user"
   * turn; everything before it (including a leading "system" turn) seeds the conversation.
   *
   * LiteRT-LM's streamed [Message]s are not documented as strictly delta-only across engine
   * versions, so each emission is diffed against the running total rather than assumed to be
   * an incremental chunk — correct whether the SDK yields deltas or cumulative text.
   */
  fun streamCompletion(turns: List<ChatTurn>): Flow<String> {
    val activeEngine = engine ?: throw IllegalStateException("No model loaded")
    val system = turns.firstOrNull { it.role == "system" }?.text
    val history = turns.filter { it.role == "user" || it.role == "assistant" }
    val last = history.lastOrNull() ?: throw IllegalArgumentException("No user message in request")
    if (last.role != "user") {
      throw IllegalArgumentException("The last message must have role 'user'")
    }
    // Message's own constructor is `internal` (library-visibility only) — the public
    // surface for building history entries is the Message.Companion factories.
    val priorMessages =
      history.dropLast(1).map { if (it.role == "user") Message.user(it.text) else Message.model(it.text) }
    val conversation: Conversation =
      activeEngine.createConversation(
        ConversationConfig(
          systemInstruction = system?.let { Contents.of(it) },
          initialMessages = priorMessages,
        ),
      )

    return flow {
      var previousFull = ""
      try {
        conversation.sendMessageAsync(last.text).collect { message ->
          val full = extractText(message)
          val delta = if (full.startsWith(previousFull)) full.substring(previousFull.length) else full
          previousFull = full
          if (delta.isNotEmpty()) {
            emit(delta)
          }
        }
      } finally {
        conversation.close()
      }
    }
  }

  private fun extractText(message: Message): String =
    message.contents.contents.filterIsInstance<Content.Text>().joinToString(separator = "") { it.text }
}
