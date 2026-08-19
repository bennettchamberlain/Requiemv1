import Capacitor
import Foundation

/// On-device chat completion for iOS, implementing the **same JS contract** as the Android
/// `@ci/capacitor-local-llm` plugin (`isAvailable` / `loadModel` / `unloadModel` / `generate` /
/// `generateStream` / `cancel`, plus the `llmToken` event). That is deliberate: `@ci/common`'s
/// `generateOffline()` already drives that contract and falls back to the appliance's
/// `/api/llm/generate` when the plugin is absent, so implementing it here makes on-device inference
/// work on iOS with **no web-layer changes at all**.
///
/// Two differences from Android:
///
/// - **A different default model.** Android's catalog points at a Gemma repo that is now
///   `gated: "auto"` on Hugging Face and answers `401 GatedRepo` to an anonymous download; this ships
///   the ungated Qwen3-0.6B instead. See `LocalLLMModels.swift` for the measurements.
/// - **Hand-written tools.** See `CompanionIntentTools.swift` — LiteRT-LM's Swift `Tool` reflects
///   over compile-time properties and has no runtime-schema equivalent of Android's `OpenApiTool`.
///   This one is forced by the runtime, not chosen.
///
/// This lives in the app target rather than in `@ci/capacitor-local-llm` (which declares itself
/// Android-only and has no `ios/`) because moving it into that package needs a podspec, a vendored
/// xcframework inside the pod, and a Podfile regeneration — mechanical, but a separate change.
@objc(LocalLLMPlugin)
public class LocalLLMPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "LocalLLMPlugin"
  public let jsName = "LocalLLM"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getModelStatus", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "loadModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "unloadModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "generateStream", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "configureIntentTools", returnType: CAPPluginReturnPromise),
  ]

  private let engine = LocalLLMEngine()
  private var generationTask: Task<Void, Never>?

  /// Forwards every progress tick to JS as `modelDownloadProgress`, matching Android's event shape.
  private lazy var downloader = ModelDownloader { [weak self] modelId, status, downloaded, total in
    self?.notifyListeners(
      modelDownloadProgressEvent,
      data: [
        "modelId": modelId,
        "status": status.rawValue,
        "bytesDownloaded": downloaded,
        "totalBytes": total,
      ])
  }

  /// Capability probe, matching Android's: no side effects, no downloads.
  ///
  /// The RAM floor mirrors the Android plugin's rationale — a ~530 MiB int4 model needs roughly 2 GB
  /// resident, and jetsam kills the app rather than failing the allocation, so refusing up front is
  /// the difference between "unavailable" and "the app disappeared mid-sentence".
  @objc func isAvailable(_ call: CAPPluginCall) {
    let totalMemory = ProcessInfo.processInfo.physicalMemory

    guard totalMemory >= Self.minimumPhysicalMemoryBytes else {
      call.resolve([
        "available": false,
        "reason": "This device does not have enough memory to run an on-device model.",
      ])

      return
    }

    call.resolve(["available": true])
  }

  /// Current on-disk state of a model, with byte progress while downloading. Matches Android's
  /// `getModelStatus`.
  @objc func getModelStatus(_ call: CAPPluginCall) {
    guard let info = resolveModel(call) else { return }

    call.resolve(downloader.status(of: info).asDictionary)
  }

  /// Starts (or resumes) the model download, reporting progress via `modelDownloadProgress`.
  ///
  /// Resolves once the download is *enqueued*, not once it completes — same contract as Android, so
  /// callers listen for the terminal `ready`/`error` event or poll `getModelStatus`.
  @objc func downloadModel(_ call: CAPPluginCall) {
    guard let info = resolveModel(call) else { return }

    do {
      try downloader.start(info)
      call.resolve()
    } catch {
      call.reject("Could not start the download: \(error.localizedDescription)")
    }
  }

  /// Deletes the downloaded model and any partial, cancelling an in-flight download first.
  @objc func deleteModel(_ call: CAPPluginCall) {
    guard let info = resolveModel(call) else { return }

    // Unload first: deleting the file out from under a live engine leaves it holding a handle to a
    // path that no longer exists, and the failure only surfaces at the next generate().
    Task {
      if await engine.modelPath == (try? LocalLLMModels.modelFile(info))?.path {
        await engine.unload()
      }
      downloader.delete(info)
      call.resolve()
    }
  }

  /// Loads a downloaded model. Takes `modelId` (matching Android); `path` is still accepted as an
  /// escape hatch for a hand-pushed file, which is how this was tested before the downloader existed.
  @objc func loadModel(_ call: CAPPluginCall) {
    let path: String
    var info: LocalLLMModelInfo?

    if let explicit = call.getString("path") {
      path = explicit
    } else if let modelId = call.getString("modelId") {
      guard let resolved = LocalLLMModels.find(modelId) else {
        call.reject("Unknown modelId: \(modelId)")

        return
      }
      guard let file = try? LocalLLMModels.modelFile(resolved) else {
        call.reject("Could not resolve the models directory")

        return
      }
      info = resolved
      path = file.path
    } else {
      call.reject("modelId (or path) is required")

      return
    }

    guard FileManager.default.fileExists(atPath: path) else {
      call.reject("Model is not downloaded. Call downloadModel() first.")

      return
    }

    Task {
      do {
        try await engine.load(modelPath: path, maxTokens: info?.defaultMaxTokens)
        call.resolve()
      } catch {
        call.reject("Failed to load model: \(error.localizedDescription)")
      }
    }
  }

  /// Shared `modelId` → catalog lookup, rejecting the call on a miss. Returns nil when it rejected.
  private func resolveModel(_ call: CAPPluginCall) -> LocalLLMModelInfo? {
    guard let modelId = call.getString("modelId") else {
      call.reject("modelId is required")

      return nil
    }
    guard let info = LocalLLMModels.find(modelId) else {
      call.reject("Unknown modelId: \(modelId)")

      return nil
    }

    return info
  }

  @objc func unloadModel(_ call: CAPPluginCall) {
    Task {
      await engine.unload()
      call.resolve()
    }
  }

  /// Non-streaming: buffers the whole reply. Tools are attached when the conversation is created.
  @objc func generate(_ call: CAPPluginCall) {
    guard let prompt = call.getString("prompt") else {
      call.reject("prompt is required")

      return
    }

    Task {
      do {
        let tools = CompanionToolContext.executableTools()
        let stream = try await engine.streamCompletion(
          turns: [ChatTurn(role: "user", text: prompt)], tools: tools)
        var text = ""

        for try await delta in stream {
          text += delta
        }

        call.resolve(["text": text])
      } catch {
        call.reject("Generation failed: \(error.localizedDescription)")
      }
    }
  }

  /// Streaming: emits `llmToken` events (`{partial, done}`), resolving once generation completes —
  /// the exact shape `generateOffline`'s `generateLocalStreaming` subscribes to.
  @objc func generateStream(_ call: CAPPluginCall) {
    guard let prompt = call.getString("prompt") else {
      call.reject("prompt is required")

      return
    }

    generationTask?.cancel()
    generationTask = Task {
      do {
        let tools = CompanionToolContext.executableTools()
        let stream = try await engine.streamCompletion(
          turns: [ChatTurn(role: "user", text: prompt)], tools: tools)

        for try await delta in stream {
          notifyListeners("llmToken", data: ["partial": delta, "done": false])
        }

        notifyListeners("llmToken", data: ["partial": "", "done": true])
        call.resolve()
      } catch {
        // A cancel() is a normal end, not a failure: report the terminal event and resolve, so the
        // JS side's `finally` unsubscribes cleanly instead of surfacing an error to the user.
        if Task.isCancelled {
          notifyListeners("llmToken", data: ["partial": "", "done": true])
          call.resolve()
        } else {
          call.reject("Generation failed: \(error.localizedDescription)")
        }
      }
    }
  }

  @objc func cancel(_ call: CAPPluginCall) {
    generationTask?.cancel()
    generationTask = nil
    Task {
      await engine.cancel()
      call.resolve()
    }
  }

  /// Points the on-device model's tool calling at a CI-Server, or turns it off.
  ///
  /// Credentials are passed in from the web layer (which already holds the configured origin and the
  /// minted API key) rather than read from the Keychain here, so this matches the Android plugin's
  /// contract exactly and only one place knows how the app stores credentials.
  ///
  /// Fetches the catalog immediately, so `toolCount` reflects what the appliance will actually allow.
  @objc func configureIntentTools(_ call: CAPPluginCall) {
    let enabled = call.getBool("enabled") ?? true

    guard enabled else {
      CompanionToolContext.disable()
      call.resolve(["toolCount": 0])

      return
    }

    guard
      let baseUrlString = call.getString("baseUrl"),
      let baseURL = URL(string: baseUrlString),
      let apiKey = call.getString("apiKey"),
      !apiKey.isEmpty
    else {
      call.reject("baseUrl and apiKey are required to enable intent tools")

      return
    }

    CompanionToolContext.client = CompanionIntentClient(baseURL: baseURL, apiKey: apiKey)

    Task {
      let tools = await CompanionToolContext.refreshRulings()
      call.resolve(["toolCount": tools.count])
    }
  }

  /// 6 GB, matching the RAM floor the Android catalog declares for the same class of int4 model.
  private static let minimumPhysicalMemoryBytes: UInt64 = 6 * 1024 * 1024 * 1024
}
