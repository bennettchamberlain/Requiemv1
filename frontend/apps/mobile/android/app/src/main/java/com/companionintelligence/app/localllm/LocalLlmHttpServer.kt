package com.companionintelligence.app.localllm

import fi.iki.elonen.NanoHTTPD
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject

/**
 * Loopback-only HTTP server (127.0.0.1, random port) exposing the sidecar's Phase-3
 * contract: `GET /api/health` and `POST /v1/chat/completions` (OpenAI-compatible, with
 * SSE streaming). Every route except `/api/health` and CORS preflight requires
 * `Authorization: Bearer <token>` — the per-launch token handed to the WebView by
 * [LocalLlmPlugin.start], so nothing else on the device can reach it.
 */
class LocalLlmHttpServer(
  private val engine: LocalLlmEngine,
  private val token: String,
) : NanoHTTPD("127.0.0.1", 0) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  val boundPort: Int
    get() = listeningPort

  override fun serve(session: IHTTPSession): Response {
    val cors =
      mapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers" to "Content-Type, Authorization",
      )

    if (session.method == Method.OPTIONS) {
      return newFixedLengthResponse(Response.Status.NO_CONTENT, MIME_PLAINTEXT, "").withHeaders(cors)
    }

    if (session.uri == "/api/health" && session.method == Method.GET) {
      val body =
        JSONObject()
          .put("status", "ok")
          .put("modelLoaded", engine.isLoaded)
          .put("modelPath", engine.modelPath)
      return jsonResponse(Response.Status.OK, body, cors)
    }

    if (session.headers["authorization"] != "Bearer $token") {
      return jsonResponse(Response.Status.UNAUTHORIZED, JSONObject().put("error", "unauthorized"), cors)
    }

    if (session.uri == "/v1/chat/completions" && session.method == Method.POST) {
      return handleChatCompletions(session, cors)
    }

    return jsonResponse(Response.Status.NOT_FOUND, JSONObject().put("error", "not_found"), cors)
  }

  private fun handleChatCompletions(session: IHTTPSession, cors: Map<String, String>): Response {
    if (!engine.isLoaded) {
      return jsonResponse(Response.Status.SERVICE_UNAVAILABLE, JSONObject().put("error", "model_not_loaded"), cors)
    }

    val request: JSONObject
    val turns: List<ChatTurn>
    try {
      request = JSONObject(readBody(session))
      turns = parseTurns(request.getJSONArray("messages"))
    } catch (e: Exception) {
      return jsonResponse(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid_request: ${e.message}"), cors)
    }

    val model = request.optString("model", engine.modelPath ?: "local")

    if (!request.optBoolean("stream", false)) {
      return try {
        val text =
          runBlocking {
            val sb = StringBuilder()
            engine.streamCompletion(turns).collect { sb.append(it) }
            sb.toString()
          }
        jsonResponse(Response.Status.OK, buildCompletionJson(model, text), cors)
      } catch (e: Exception) {
        jsonResponse(Response.Status.INTERNAL_ERROR, JSONObject().put("error", e.message ?: "generation_failed"), cors)
      }
    }

    val pipedOut = PipedOutputStream()
    val pipedIn = PipedInputStream(pipedOut, 8192)
    scope.launch {
      try {
        engine.streamCompletion(turns).collect { delta -> writeSse(pipedOut, buildChunkJson(model, delta).toString()) }
        writeSse(pipedOut, "[DONE]")
      } catch (e: Exception) {
        writeSse(pipedOut, JSONObject().put("error", e.message ?: "generation_failed").toString())
      } finally {
        pipedOut.close()
      }
    }
    val response = newChunkedResponse(Response.Status.OK, "text/event-stream", pipedIn)
    response.addHeader("Cache-Control", "no-cache")
    response.addHeader("Connection", "keep-alive")
    return response.withHeaders(cors)
  }

  private fun readBody(session: IHTTPSession): String {
    val files = HashMap<String, String>()
    session.parseBody(files)
    return files["postData"] ?: ""
  }

  private fun parseTurns(messages: JSONArray): List<ChatTurn> {
    val turns = mutableListOf<ChatTurn>()
    for (i in 0 until messages.length()) {
      val m = messages.getJSONObject(i)
      turns.add(ChatTurn(role = m.getString("role"), text = m.getString("content")))
    }
    return turns
  }

  private fun buildCompletionJson(model: String, text: String): JSONObject {
    val message = JSONObject().put("role", "assistant").put("content", text)
    val choice = JSONObject().put("index", 0).put("message", message).put("finish_reason", "stop")
    return JSONObject()
      .put("id", "chatcmpl-local-${System.currentTimeMillis()}")
      .put("object", "chat.completion")
      .put("created", System.currentTimeMillis() / 1000)
      .put("model", model)
      .put("choices", JSONArray().put(choice))
  }

  private fun buildChunkJson(model: String, delta: String): JSONObject {
    val deltaObj = JSONObject().put("content", delta)
    val choice = JSONObject().put("index", 0).put("delta", deltaObj).put("finish_reason", JSONObject.NULL)
    return JSONObject()
      .put("id", "chatcmpl-local-${System.currentTimeMillis()}")
      .put("object", "chat.completion.chunk")
      .put("created", System.currentTimeMillis() / 1000)
      .put("model", model)
      .put("choices", JSONArray().put(choice))
  }

  private fun writeSse(out: PipedOutputStream, payload: String) {
    out.write("data: $payload\n\n".toByteArray(StandardCharsets.UTF_8))
    out.flush()
  }

  private fun jsonResponse(status: Response.Status, body: JSONObject, headers: Map<String, String>): Response =
    newFixedLengthResponse(status, "application/json", body.toString()).withHeaders(headers)

  private fun Response.withHeaders(headers: Map<String, String>): Response {
    headers.forEach { (key, value) -> addHeader(key, value) }
    return this
  }
}
