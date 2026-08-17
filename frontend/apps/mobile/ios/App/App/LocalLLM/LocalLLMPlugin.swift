import Capacitor
import Foundation

/// On-device chat completion for iOS, implementing the **same JS contract** as the Android
/// `@ci/capacitor-local-llm` plugin (`isAvailable` / `loadModel` / `unloadModel` / `generate` /
/// `generateStream` / `cancel`, plus the `llmToken` event). That is deliberate: `@ci/common`'s
/// `generateOffline()` already drives that contract and falls back to the appliance's
/// `/api/llm/generate` when the plugin is absent, so implementing it here makes on-device inference
/// work on iOS with **no web-layer changes at all**.
///
/// Two differences from Android, both forced rather than chosen:
///
/// - **No model download.** Android ships a WorkManager downloader; here `loadModel` takes a path
///   to a `.litertlm` file already on the device. Wiring a downloader is follow-up work.
/// - **Hand-written tools.** See `CompanionIntentTools.swift` — LiteRT-LM's Swift `Tool` reflects
///   over compile-time properties and has no runtime-schema equivalent of Android's `OpenApiTool`.
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
    CAPPluginMethod(name: "loadModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "unloadModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "generateStream", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "configureIntentTools", returnType: CAPPluginReturnPromise),
  ]

  private let engine = LocalLLMEngine()
  private var generationTask: Task<Void, Never>?

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

  @objc func loadModel(_ call: CAPPluginCall) {
    guard let path = call.getString("path") else {
      call.reject("path is required (iOS has no model downloader yet — pass an on-device file path)")

      return
    }
    guard FileManager.default.fileExists(atPath: path) else {
      call.reject("Model file not found at \(path)")

      return
    }

    Task {
      do {
        try await engine.load(modelPath: path)
        call.resolve()
      } catch {
        call.reject("Failed to load model: \(error.localizedDescription)")
      }
    }
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
