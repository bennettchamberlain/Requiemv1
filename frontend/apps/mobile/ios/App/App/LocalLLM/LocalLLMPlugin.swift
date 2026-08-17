import Capacitor
import Foundation

/// On-device chat completion (Phase 3 "Thinks" of the disconnected-mode design doc). The
/// JS bridge is control-plane only — start/stop/status/model management — matching
/// `frontend/packages/common/src/utils/nativeBridge.ts`'s `LocalLLMPlugin` interface.
/// Actual chat traffic goes straight from the web bundle to the loopback HTTP server this
/// plugin starts, so the same fetch/SSE code path used for the appliance works unchanged.
///
/// LiteRT-LM's Swift package targets iOS 15+ (matches this project's deployment target),
/// so unlike the Android plugin this one has no extra platform-floor gate.
@objc(LocalLLMPlugin)
public class LocalLLMPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "LocalLLMPlugin"
  public let jsName = "LocalLLM"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "loadModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "unloadModel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
  ]

  private let engine = LocalLLMEngine()
  private var server: LocalLLMHTTPServer?
  private var token: String?
  private var downloadTask: URLSessionDownloadTask?

  @objc func getStatus(_ call: CAPPluginCall) {
    Task {
      let isLoaded = await engine.isLoaded
      let modelPath = await engine.modelPath
      var result: [String: Any] = [
        "supported": true,
        "running": server != nil,
        "modelLoaded": isLoaded,
      ]
      if let modelPath { result["modelPath"] = modelPath }
      if let server { result["baseUrl"] = "http://127.0.0.1:\(server.port)" }
      call.resolve(result)
    }
  }

  @objc func start(_ call: CAPPluginCall) {
    if let server, let token {
      call.resolve(["baseUrl": "http://127.0.0.1:\(server.port)", "token": token])
      return
    }

    Task {
      let newToken = Self.generateToken()
      let newServer = LocalLLMHTTPServer(engine: engine, token: newToken)
      do {
        try await newServer.start()
      } catch {
        call.reject("Failed to start local server: \(error.localizedDescription)")
        return
      }
      self.server = newServer
      self.token = newToken
      call.resolve(["baseUrl": "http://127.0.0.1:\(newServer.port)", "token": newToken])
    }
  }

  @objc func stop(_ call: CAPPluginCall) {
    server?.stop()
    server = nil
    token = nil
    call.resolve()
  }

  @objc func loadModel(_ call: CAPPluginCall) {
    guard let path = call.getString("path") else {
      call.reject("path is required")
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

  @objc func downloadModel(_ call: CAPPluginCall) {
    guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
      call.reject("url is required")
      return
    }
    guard let fileName = call.getString("fileName") else {
      call.reject("fileName is required")
      return
    }

    let destinationDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("local-llm-models", isDirectory: true)
    try? FileManager.default.createDirectory(at: destinationDir, withIntermediateDirectories: true)
    let destination = destinationDir.appendingPathComponent(fileName)

    let delegate = DownloadProgressDelegate(
      onProgress: { [weak self] downloaded, total in
        self?.notifyListeners(
          "downloadProgress",
          data: ["fileName": fileName, "downloaded": downloaded, "total": total])
      },
      onFinished: { [weak self] result in
        switch result {
        case .success(let tempURL):
          do {
            if FileManager.default.fileExists(atPath: destination.path) {
              try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: tempURL, to: destination)
            call.resolve(["path": destination.path])
          } catch {
            call.reject("Failed to save downloaded model: \(error.localizedDescription)")
          }
        case .failure(let error):
          call.reject("Download failed: \(error.localizedDescription)")
        }
        self?.downloadTask = nil
      }
    )

    let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
    let task = session.downloadTask(with: url)
    downloadTask = task
    task.resume()
  }

  private static func generateToken() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return bytes.map { String(format: "%02x", $0) }.joined()
  }
}

/// Bridges `URLSessionDownloadDelegate`'s callback API to plain closures.
private final class DownloadProgressDelegate: NSObject, URLSessionDownloadDelegate {
  private let onProgress: (Int64, Int64) -> Void
  private let onFinished: (Result<URL, Error>) -> Void

  init(onProgress: @escaping (Int64, Int64) -> Void, onFinished: @escaping (Result<URL, Error>) -> Void) {
    self.onProgress = onProgress
    self.onFinished = onFinished
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    onProgress(totalBytesWritten, totalBytesExpectedToWrite)
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    // The delegate-provided file is deleted once this method returns, so it must be
    // moved to a stable temp location before handing control back to the caller.
    let stableTemp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    do {
      try FileManager.default.moveItem(at: location, to: stableTemp)
      onFinished(.success(stableTemp))
    } catch {
      onFinished(.failure(error))
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      onFinished(.failure(error))
    }
  }
}
