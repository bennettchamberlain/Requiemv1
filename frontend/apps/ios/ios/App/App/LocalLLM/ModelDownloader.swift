import Foundation

/// Lifecycle of a model on disk. Mirrors Android's `LocalLlmModelStatus` and the TS union in
/// `@ci/capacitor-local-llm`'s `definitions.ts`.
enum ModelStatus: String {
  case notDownloaded = "not_downloaded"
  case downloading
  case ready
  case error
}

struct ModelStatusResult {
  let status: ModelStatus
  let bytesDownloaded: Int64
  let totalBytes: Int64
  let error: String?

  var asDictionary: [String: Any] {
    var result: [String: Any] = ["status": status.rawValue]

    // Only meaningful mid-download or after a failure; omitted otherwise so a caller cannot
    // mistake a hardcoded 0 for "nothing downloaded yet".
    if status == .downloading || status == .error {
      result["bytesDownloaded"] = bytesDownloaded
      result["totalBytes"] = totalBytes
    }
    if let error { result["error"] = error }

    return result
  }
}

/// Resumable model download, the iOS counterpart to Android's WorkManager `ModelDownloadWorker`.
///
/// Deliberately built on a manual `Range` request streaming into a `.part` file rather than
/// `URLSessionDownloadTask`'s `resumeData`:
///
/// - It matches Android's on-disk convention exactly (`<name>.part`, promoted on completion), so
///   the two platforms are debuggable the same way.
/// - `resumeData` is opaque, is invalidated by app termination in several documented cases, and
///   cannot resume a download that was interrupted by the user force-quitting. A byte offset on
///   disk survives all of that: the next attempt just asks for `bytes=<size>-`.
///
/// One download per model at a time; a second `start` for the same model is ignored rather than
/// racing a second writer onto the same `.part` file.
final class ModelDownloader: NSObject {
  typealias ProgressHandler = (_ modelId: String, _ status: ModelStatus, _ downloaded: Int64, _ total: Int64) -> Void

  private let onProgress: ProgressHandler
  private var session: URLSession!
  private var active: [Int: Download] = [:]
  private let lock = NSLock()

  private final class Download {
    let info: LocalLLMModelInfo
    let handle: FileHandle
    let destination: URL
    let partial: URL
    /// Bytes already on disk when this attempt started — the base for reported progress, since the
    /// server only streams the remainder of a ranged request.
    let resumeOffset: Int64
    var received: Int64 = 0
    var expectedTotal: Int64

    init(info: LocalLLMModelInfo, handle: FileHandle, destination: URL, partial: URL, resumeOffset: Int64) {
      self.info = info
      self.handle = handle
      self.destination = destination
      self.partial = partial
      self.resumeOffset = resumeOffset
      self.expectedTotal = info.sizeBytes
    }

    var downloadedTotal: Int64 { resumeOffset + received }
  }

  init(onProgress: @escaping ProgressHandler) {
    self.onProgress = onProgress
    super.init()

    let configuration = URLSessionConfiguration.default
    // A half-gigabyte download over a slow link must not trip the default 60s resource timeout.
    configuration.timeoutIntervalForRequest = 60
    configuration.timeoutIntervalForResource = 60 * 60 * 6
    self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }

  /// Current on-disk state, with byte progress when a download is in flight or was interrupted.
  func status(of info: LocalLLMModelInfo) -> ModelStatusResult {
    guard
      let destination = try? LocalLLMModels.modelFile(info),
      let partial = try? LocalLLMModels.partialFile(info)
    else {
      return ModelStatusResult(status: .error, bytesDownloaded: 0, totalBytes: info.sizeBytes,
                               error: "Could not resolve the models directory")
    }

    if FileManager.default.fileExists(atPath: destination.path) {
      // A truncated file is worse than a missing one: it loads and then fails deep inside the
      // engine. Treat a size mismatch as "not downloaded" so the next call re-fetches it.
      let onDisk = fileSize(destination)

      if onDisk == info.sizeBytes {
        return ModelStatusResult(status: .ready, bytesDownloaded: onDisk, totalBytes: onDisk, error: nil)
      }

      return ModelStatusResult(
        status: .error, bytesDownloaded: onDisk, totalBytes: info.sizeBytes,
        error: "Downloaded file is \(onDisk) bytes, expected \(info.sizeBytes). Delete and re-download.")
    }

    if isDownloading(info.modelId) {
      let downloaded = fileSize(partial)

      return ModelStatusResult(status: .downloading, bytesDownloaded: downloaded,
                               totalBytes: info.sizeBytes, error: nil)
    }

    if FileManager.default.fileExists(atPath: partial.path) {
      // Interrupted, not in flight. Reported as `downloading` with real byte progress — the next
      // `downloadModel` resumes from here rather than starting over.
      return ModelStatusResult(status: .downloading, bytesDownloaded: fileSize(partial),
                               totalBytes: info.sizeBytes, error: nil)
    }

    return ModelStatusResult(status: .notDownloaded, bytesDownloaded: 0, totalBytes: info.sizeBytes, error: nil)
  }

  /// Starts (or resumes) the download. Throws only on conditions the caller can act on; transport
  /// failures surface through the progress handler as `.error`.
  func start(_ info: LocalLLMModelInfo) throws {
    if isDownloading(info.modelId) { return }

    let destination = try LocalLLMModels.modelFile(info)
    if FileManager.default.fileExists(atPath: destination.path), fileSize(destination) == info.sizeBytes {
      onProgress(info.modelId, .ready, info.sizeBytes, info.sizeBytes)

      return
    }

    guard freeDiskBytes() > minimumFreeDiskBytes else {
      throw IntentToolError.transport("Not enough free space to download the model (need ~1 GB).")
    }

    let partial = try LocalLLMModels.partialFile(info)
    if !FileManager.default.fileExists(atPath: partial.path) {
      FileManager.default.createFile(atPath: partial.path, contents: nil)
    }

    let resumeOffset = fileSize(partial)
    let handle = try FileHandle(forWritingTo: partial)
    try handle.seekToEnd()

    var request = URLRequest(url: info.url)
    if resumeOffset > 0 {
      request.setValue("bytes=\(resumeOffset)-", forHTTPHeaderField: "Range")
    }

    let task = session.dataTask(with: request)
    let download = Download(info: info, handle: handle, destination: destination,
                            partial: partial, resumeOffset: resumeOffset)

    lock.lock()
    active[task.taskIdentifier] = download
    lock.unlock()

    onProgress(info.modelId, .downloading, resumeOffset, info.sizeBytes)
    task.resume()
  }

  /// Cancels any in-flight download and removes both the finished file and the partial.
  func delete(_ info: LocalLLMModelInfo) {
    cancel(info.modelId)

    if let destination = try? LocalLLMModels.modelFile(info) {
      try? FileManager.default.removeItem(at: destination)
    }
    if let partial = try? LocalLLMModels.partialFile(info) {
      try? FileManager.default.removeItem(at: partial)
    }
  }

  /// Cancels an in-flight download, leaving the `.part` file so it can be resumed later.
  func cancel(_ modelId: String) {
    session.getAllTasks { tasks in
      for task in tasks {
        self.lock.lock()
        let matches = self.active[task.taskIdentifier]?.info.modelId == modelId
        self.lock.unlock()

        if matches { task.cancel() }
      }
    }
  }

  private func isDownloading(_ modelId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }

    return active.values.contains { $0.info.modelId == modelId }
  }

  private func fileSize(_ url: URL) -> Int64 {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) as? Int64 ?? 0
  }

  private func freeDiskBytes() -> Int64 {
    let path = (try? LocalLLMModels.modelsDirectory()) ?? URL(fileURLWithPath: NSTemporaryDirectory())
    let values = try? path.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])

    return values?.volumeAvailableCapacityForImportantUsage ?? Int64.max
  }
}

extension ModelDownloader: URLSessionDataDelegate {
  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    lock.lock()
    let download = active[dataTask.taskIdentifier]
    lock.unlock()

    guard let download, let http = response as? HTTPURLResponse else {
      completionHandler(.cancel)

      return
    }

    // 206 = ranged resume honoured. 200 with a resume offset means the server ignored the Range
    // header and is restarting from byte 0 — appending would corrupt the file, so truncate first.
    if download.resumeOffset > 0 && http.statusCode == 200 {
      try? download.handle.truncate(atOffset: 0)
      try? download.handle.seek(toOffset: 0)
    }

    guard (200..<300).contains(http.statusCode) else {
      finish(dataTask, error: IntentToolError.transport("Download failed (HTTP \(http.statusCode))"))
      completionHandler(.cancel)

      return
    }

    if http.expectedContentLength > 0 {
      let base = http.statusCode == 206 ? download.resumeOffset : 0
      download.expectedTotal = base + http.expectedContentLength
    }

    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock()
    let download = active[dataTask.taskIdentifier]
    lock.unlock()

    guard let download else { return }

    do {
      try download.handle.write(contentsOf: data)
    } catch {
      dataTask.cancel()
      finish(dataTask, error: error)

      return
    }

    download.received += Int64(data.count)
    onProgress(download.info.modelId, .downloading, download.downloadedTotal, download.expectedTotal)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    finish(task, error: error)
  }

  private func finish(_ task: URLSessionTask, error: Error?) {
    lock.lock()
    guard let download = active.removeValue(forKey: task.taskIdentifier) else {
      lock.unlock()

      return
    }
    lock.unlock()

    try? download.handle.close()

    if let error {
      // The `.part` file is intentionally left in place: the next start() resumes from it. A
      // cancellation is a pause, not a failure, so it is reported as such.
      let cancelled = (error as NSError).code == NSURLErrorCancelled
      onProgress(download.info.modelId, cancelled ? .downloading : .error,
                 fileSize(download.partial), download.expectedTotal)

      if !cancelled {
        NSLog("[LocalLLM] model download failed: %@", error.localizedDescription)
      }

      return
    }

    let finalSize = fileSize(download.partial)

    guard finalSize == download.info.sizeBytes else {
      // Truncated rather than failed-outright: keep the partial so a retry resumes, and report the
      // mismatch instead of promoting a file that would fail deep inside the engine at load time.
      NSLog("[LocalLLM] model download incomplete: %lld of %lld bytes", finalSize, download.info.sizeBytes)
      onProgress(download.info.modelId, .downloading, finalSize, download.info.sizeBytes)

      return
    }

    do {
      if FileManager.default.fileExists(atPath: download.destination.path) {
        try FileManager.default.removeItem(at: download.destination)
      }
      try FileManager.default.moveItem(at: download.partial, to: download.destination)
      onProgress(download.info.modelId, .ready, finalSize, finalSize)
    } catch {
      onProgress(download.info.modelId, .error, finalSize, download.info.sizeBytes)
      NSLog("[LocalLLM] could not promote the downloaded model: %@", error.localizedDescription)
    }
  }
}
