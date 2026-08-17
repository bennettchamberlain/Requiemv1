import Foundation
import Network

enum LocalLLMServerError: Error, LocalizedError {
  case failedToStart

  var errorDescription: String? { "Failed to start the local model server" }
}

/// Loopback-only HTTP server (127.0.0.1, random port) exposing the sidecar's Phase-3
/// contract: `GET /api/health` and `POST /v1/chat/completions` (OpenAI-compatible,
/// with SSE streaming). Every route except `/api/health` and CORS preflight requires
/// `Authorization: Bearer <token>` — the per-launch token handed to the WebView by
/// `LocalLLMPlugin.start`, so nothing else on the device can reach it.
///
/// Built directly on `Network.framework` rather than a third-party HTTP library, to
/// avoid adding a second risky native dependency alongside the LiteRT-LM SPM package —
/// the HTTP surface here is intentionally tiny (two routes, one client at a time).
final class LocalLLMHTTPServer {
  private let engine: LocalLLMEngine
  private let token: String
  private let queue = DispatchQueue(label: "com.companionintelligence.app.localllm.server")
  private var listener: NWListener?

  private(set) var port: UInt16 = 0

  init(engine: LocalLLMEngine, token: String) {
    self.engine = engine
    self.token = token
  }

  func start() async throws {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
    parameters.allowLocalEndpointReuse = true

    let listener = try NWListener(using: parameters)
    self.listener = listener

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      var resumed = false
      listener.stateUpdateHandler = { state in
        guard !resumed else { return }
        switch state {
        case .ready:
          resumed = true
          continuation.resume()
        case .failed(let error):
          resumed = true
          continuation.resume(throwing: error)
        default:
          break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        self?.handle(connection: connection)
      }
      listener.start(queue: queue)
    }

    guard let boundPort = listener.port?.rawValue else {
      throw LocalLLMServerError.failedToStart
    }
    self.port = boundPort
  }

  func stop() {
    listener?.cancel()
    listener = nil
    port = 0
  }

  private func handle(connection: NWConnection) {
    connection.start(queue: queue)
    receiveRequest(on: connection, buffer: Data())
  }

  private func receiveRequest(on connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
      guard let self else { return }

      var accumulated = buffer
      if let data, !data.isEmpty {
        accumulated.append(data)
      }

      if error != nil {
        connection.cancel()
        return
      }

      guard let request = HTTPRequestParser.parse(accumulated) else {
        if isComplete {
          connection.cancel()
        } else {
          self.receiveRequest(on: connection, buffer: accumulated)
        }
        return
      }

      Task {
        await self.route(request: request, connection: connection)
      }
    }
  }

  private func route(request: HTTPRequestParser.Request, connection: NWConnection) async {
    let cors: [String: String] = [
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ]

    if request.method == "OPTIONS" {
      send(HTTPResponseWriter.fixed(status: 204, statusText: "No Content", headers: cors, body: Data()), on: connection)
      return
    }

    if request.path == "/api/health" && request.method == "GET" {
      let isLoaded = await engine.isLoaded
      let modelPath = await engine.modelPath
      let body: [String: Any?] = ["status": "ok", "modelLoaded": isLoaded, "modelPath": modelPath]
      sendJson(body, status: 200, headers: cors, on: connection)
      return
    }

    guard request.headers["authorization"] == "Bearer \(token)" else {
      sendJson(["error": "unauthorized"], status: 401, headers: cors, on: connection)
      return
    }

    if request.path == "/v1/chat/completions" && request.method == "POST" {
      await handleChatCompletions(request: request, cors: cors, connection: connection)
      return
    }

    sendJson(["error": "not_found"], status: 404, headers: cors, on: connection)
  }

  private func handleChatCompletions(
    request: HTTPRequestParser.Request, cors: [String: String], connection: NWConnection
  ) async {
    guard await engine.isLoaded else {
      sendJson(["error": "model_not_loaded"], status: 503, headers: cors, on: connection)
      return
    }

    guard
      let json = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any],
      let rawMessages = json["messages"] as? [[String: Any]]
    else {
      sendJson(["error": "invalid_request"], status: 400, headers: cors, on: connection)
      return
    }

    let turns = rawMessages.compactMap { entry -> ChatTurn? in
      guard let role = entry["role"] as? String, let content = entry["content"] as? String else { return nil }
      return ChatTurn(role: role, text: content)
    }
    let requestedModel = json["model"] as? String
    let model: String
    if let requestedModel {
      model = requestedModel
    } else {
      model = await engine.modelPath ?? "local"
    }
    let stream = (json["stream"] as? Bool) ?? false

    let deltas: AsyncThrowingStream<String, Error>
    do {
      deltas = try await engine.streamCompletion(turns: turns)
    } catch {
      sendJson(["error": error.localizedDescription], status: 400, headers: cors, on: connection)
      return
    }

    if !stream {
      do {
        var full = ""
        for try await delta in deltas {
          full += delta
        }
        sendJson(chatCompletionBody(model: model, text: full), status: 200, headers: cors, on: connection)
      } catch {
        sendJson(["error": error.localizedDescription], status: 500, headers: cors, on: connection)
      }
      return
    }

    let headers = cors.merging(["Cache-Control": "no-cache", "Connection": "keep-alive"]) { _, new in new }
    sendChunkedHeader(status: 200, contentType: "text/event-stream", headers: headers, on: connection)

    do {
      for try await delta in deltas {
        let chunk = chatChunkBody(model: model, delta: delta)
        sendChunkedBody(sseFrame(chunk), on: connection)
      }
      sendChunkedBody(sseFrame(rawPayload: "[DONE]"), on: connection)
    } catch {
      sendChunkedBody(sseFrame(["error": error.localizedDescription]), on: connection)
    }
    sendChunkedTerminator(on: connection)
  }

  private func chatCompletionBody(model: String, text: String) -> [String: Any] {
    [
      "id": "chatcmpl-local-\(Int(Date().timeIntervalSince1970 * 1000))",
      "object": "chat.completion",
      "created": Int(Date().timeIntervalSince1970),
      "model": model,
      "choices": [["index": 0, "message": ["role": "assistant", "content": text], "finish_reason": "stop"]],
    ]
  }

  private func chatChunkBody(model: String, delta: String) -> [String: Any] {
    [
      "id": "chatcmpl-local-\(Int(Date().timeIntervalSince1970 * 1000))",
      "object": "chat.completion.chunk",
      "created": Int(Date().timeIntervalSince1970),
      "model": model,
      "choices": [["index": 0, "delta": ["content": delta], "finish_reason": NSNull()]],
    ]
  }

  private func sseFrame(_ json: [String: Any]) -> Data {
    let payload = (try? JSONSerialization.data(withJSONObject: json)) ?? Data()
    let payloadStr = String(data: payload, encoding: .utf8) ?? "{}"
    return sseFrame(rawPayload: payloadStr)
  }

  private func sseFrame(rawPayload: String) -> Data {
    Data("data: \(rawPayload)\n\n".utf8)
  }

  private func send(_ data: Data, on connection: NWConnection) {
    connection.send(
      content: data,
      completion: .contentProcessed { _ in
        connection.cancel()
      })
  }

  private func sendJson(_ body: [String: Any?], status: Int, headers: [String: String], on connection: NWConnection) {
    let compact = body.compactMapValues { $0 }
    let data = (try? JSONSerialization.data(withJSONObject: compact)) ?? Data()
    send(HTTPResponseWriter.fixed(status: status, statusText: HTTPResponseWriter.statusText(status), headers: headers, body: data), on: connection)
  }

  private func sendChunkedHeader(status: Int, contentType: String, headers: [String: String], on connection: NWConnection) {
    let data = HTTPResponseWriter.chunkedHeader(status: status, statusText: HTTPResponseWriter.statusText(status), contentType: contentType, headers: headers)
    connection.send(content: data, completion: .contentProcessed { _ in })
  }

  private func sendChunkedBody(_ chunk: Data, on connection: NWConnection) {
    connection.send(content: HTTPResponseWriter.chunk(chunk), completion: .contentProcessed { _ in })
  }

  private func sendChunkedTerminator(on connection: NWConnection) {
    connection.send(
      content: HTTPResponseWriter.chunkTerminator(),
      completion: .contentProcessed { _ in
        connection.cancel()
      })
  }
}

/// Minimal HTTP/1.1 request-line + headers + body parser — just enough for the two
/// routes this server implements (no keep-alive multiplexing, one request per parse).
enum HTTPRequestParser {
  struct Request {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
  }

  static func parse(_ buffer: Data) -> Request? {
    guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
      return nil
    }

    let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
    guard let headerText = String(data: headerData, encoding: .utf8) else {
      return nil
    }

    var lines = headerText.components(separatedBy: "\r\n")
    guard !lines.isEmpty else { return nil }
    let requestLine = lines.removeFirst().components(separatedBy: " ")
    guard requestLine.count >= 2 else { return nil }
    let method = requestLine[0]
    let path = requestLine[1]

    var headers: [String: String] = [:]
    for line in lines {
      guard let colonIndex = line.firstIndex(of: ":") else { continue }
      let key = line[line.startIndex..<colonIndex].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: colonIndex)...].trimmingCharacters(in: .whitespaces)
      headers[key] = value
    }

    let bodyStart = headerEnd.upperBound
    let contentLength = Int(headers["content-length"] ?? "0") ?? 0
    let availableBody = buffer.count - buffer.distance(from: buffer.startIndex, to: bodyStart)

    guard availableBody >= contentLength else {
      return nil
    }

    let body = buffer.subdata(in: bodyStart..<buffer.index(bodyStart, offsetBy: contentLength))
    return Request(method: method, path: path, headers: headers, body: body)
  }
}

/// Minimal HTTP/1.1 response writer, including hand-rolled chunked transfer-encoding
/// for the SSE streaming path (no third-party server library is used — see the
/// `LocalLLMHTTPServer` doc comment).
enum HTTPResponseWriter {
  static func statusText(_ status: Int) -> String {
    switch status {
    case 200: return "OK"
    case 204: return "No Content"
    case 400: return "Bad Request"
    case 401: return "Unauthorized"
    case 404: return "Not Found"
    case 500: return "Internal Server Error"
    case 503: return "Service Unavailable"
    default: return "Unknown"
    }
  }

  static func fixed(status: Int, statusText: String, headers: [String: String], body: Data) -> Data {
    var allHeaders = headers
    allHeaders["Content-Type"] = allHeaders["Content-Type"] ?? "application/json"
    allHeaders["Content-Length"] = "\(body.count)"
    allHeaders["Connection"] = "close"

    var response = "HTTP/1.1 \(status) \(statusText)\r\n"
    for (key, value) in allHeaders {
      response += "\(key): \(value)\r\n"
    }
    response += "\r\n"

    var data = Data(response.utf8)
    data.append(body)
    return data
  }

  static func chunkedHeader(status: Int, statusText: String, contentType: String, headers: [String: String]) -> Data {
    var allHeaders = headers
    allHeaders["Content-Type"] = contentType
    allHeaders["Transfer-Encoding"] = "chunked"

    var response = "HTTP/1.1 \(status) \(statusText)\r\n"
    for (key, value) in allHeaders {
      response += "\(key): \(value)\r\n"
    }
    response += "\r\n"
    return Data(response.utf8)
  }

  static func chunk(_ payload: Data) -> Data {
    var data = Data(String(payload.count, radix: 16).utf8)
    data.append(Data("\r\n".utf8))
    data.append(payload)
    data.append(Data("\r\n".utf8))
    return data
  }

  static func chunkTerminator() -> Data {
    Data("0\r\n\r\n".utf8)
  }
}
