import Foundation

/// Errors the plugin raises for a request it refuses up front. Each message is what the user ends
/// up reading, so they say what to do about it rather than what failed internally.
enum LocalLLMError: Error, LocalizedError, Equatable {
  case insufficientMemory(modelId: String, requiredBytes: UInt64, deviceBytes: UInt64)
  case insufficientDisk(requiredBytes: Int64, availableBytes: Int64)
  case downloadURLRejected(String)
  case imageInputUnsupported(modelId: String?)

  var errorDescription: String? {
    switch self {
    case .insufficientMemory(let modelId, let required, let device):
      return
        "\(modelId) needs at least \(Self.gigabytes(required)) of memory; this device has \(Self.gigabytes(device))."
    case .insufficientDisk(let required, let available):
      return
        "Not enough free space for the model: it needs \(Self.gigabytes(UInt64(max(required, 0)))) free, and \(Self.gigabytes(UInt64(max(available, 0)))) is available."
    case .downloadURLRejected(let reason):
      return "Refusing to download from that URL: \(reason)"
    case .imageInputUnsupported(let modelId):
      return "Image input is not supported by \(modelId ?? "the on-device model") on iOS"
    }
  }

  private static func gigabytes(_ bytes: UInt64) -> String {
    String(format: "%.1f GB", Double(bytes) / 1_073_741_824)
  }
}

/// The decisions the plugin makes before it touches the network, the disk or the engine — pulled out
/// as pure functions so they are checked without a device, a model or a filesystem.
enum LocalLLMPolicy {
  /// Slack kept free on top of the bytes a download still needs, so filling the volume to the last
  /// byte does not take the rest of the app (SQLite, the WebView cache) down with it.
  static let diskHeadroomBytes: Int64 = 512 * 1024 * 1024

  // MARK: Storage

  /// Free space a download needs before it starts: what is still to fetch, plus ``diskHeadroomBytes``.
  /// Bytes already on disk (a resumable `.part`) are not needed again.
  static func requiredFreeDiskBytes(sizeBytes: Int64, bytesAlreadyOnDisk: Int64) -> Int64 {
    max(sizeBytes - max(bytesAlreadyOnDisk, 0), 0) + diskHeadroomBytes
  }

  /// `true` when a download may start. An unreadable volume (`nil`) is allowed through: refusing on
  /// "unknown" would lock out a device whose only fault is a missing capacity key.
  static func hasEnoughDisk(freeBytes: Int64?, sizeBytes: Int64, bytesAlreadyOnDisk: Int64) -> Bool {
    guard let freeBytes else { return true }

    return freeBytes >= requiredFreeDiskBytes(sizeBytes: sizeBytes, bytesAlreadyOnDisk: bytesAlreadyOnDisk)
  }

  // MARK: Memory

  /// `true` when the device has at least the model's floor. `minDeviceMemoryBytes` is compared with
  /// `ProcessInfo.physicalMemory`, which is the RAM the OS reports, not the marketing figure.
  static func meetsMemoryFloor(physicalMemory: UInt64, minDeviceMemoryBytes: UInt64) -> Bool {
    physicalMemory >= minDeviceMemoryBytes
  }

  /// `true` when the device can run at least the smallest model in `catalog` — `isAvailable`'s
  /// definition of "available". It is a capability probe, not a promise about disk or downloads.
  static func deviceCanRunAnyModel(physicalMemory: UInt64, catalog: [LocalLLMModelInfo]) -> Bool {
    guard let smallestFloor = catalog.map(\.minDeviceMemoryBytes).min() else { return false }

    return meetsMemoryFloor(physicalMemory: physicalMemory, minDeviceMemoryBytes: smallestFloor)
  }

  // MARK: Downloads

  /// Checks a caller-supplied download URL against the catalog's pinned one and refuses anything
  /// else. The plugin never downloads from the caller's URL — it always fetches `pinned` — so this
  /// exists only to tell a caller that thinks it is downloading something else that it is not.
  ///
  /// Scheme, host and path must match **exactly**; the query (`?download=true`) and fragment are
  /// ignored. A host allow-list alone is not enough: `huggingface.co` also serves any file anyone
  /// uploads, and size is the only other check the download gets, so a URL like
  /// `huggingface.co/attacker/repo/resolve/main/…` padded to the pinned size would otherwise be
  /// promoted as the "pinned" model. Compared on the parsed components, so `huggingface.co@evil.example`
  /// and `huggingface.co.evil.example` name other hosts and fail.
  static func verifyDownloadURL(_ raw: String, isPinnedURL pinned: URL, modelId: String) throws {
    guard let given = URLComponents(string: raw), given.url != nil,
      let expected = URLComponents(url: pinned, resolvingAgainstBaseURL: false)
    else {
      throw LocalLLMError.downloadURLRejected("it is not a valid URL")
    }
    guard given.scheme?.lowercased() == "https" else {
      throw LocalLLMError.downloadURLRejected("it must use https")
    }
    guard given.user == nil, given.password == nil else {
      throw LocalLLMError.downloadURLRejected("it must not carry credentials")
    }
    guard given.port == nil || given.port == 443 else {
      throw LocalLLMError.downloadURLRejected("it must use the default https port")
    }
    guard
      given.host?.lowercased() == expected.host?.lowercased(),
      given.percentEncodedPath == expected.percentEncodedPath
    else {
      throw LocalLLMError.downloadURLRejected(
        "it is not the pinned download for \(modelId); models are only fetched from the catalog's own commit-pinned URL")
    }
  }

  enum ResumePlan: Equatable {
    /// Nothing on disk: fetch the whole file.
    case fresh
    /// A shorter `.part` exists: ask for `bytes=<n>-`.
    case resume(from: Int64)
    /// A `.part` already as long as (or longer than) the whole file, yet never promoted. It is not
    /// resumable — `Range` past the end answers 416 — and its bytes cannot be trusted, so it is
    /// dropped and the download starts over. Real case: the pre-pinning Qwen3 download, which
    /// finished at the new size, failed the old size check and left exactly this behind.
    case restart
  }

  static func resumePlan(partialBytes: Int64, expectedBytes: Int64) -> ResumePlan {
    if partialBytes <= 0 { return .fresh }
    if partialBytes >= expectedBytes { return .restart }

    return .resume(from: partialBytes)
  }

  /// What an unfinished `.part` on disk means when no download is running.
  enum PartialState: Equatable {
    /// No bytes: nothing to resume, nothing to report.
    case empty
    /// Fewer bytes than the file: a download that was interrupted (a dropped connection, the app
    /// backgrounded or killed). Resumable, but not *in progress* — reporting it as `downloading`
    /// leaves the UI with nothing to press but Cancel.
    case interrupted
    /// Exactly the size of the file yet not promoted. Indistinguishable from the instant between the
    /// last byte arriving and the rename, so it is reported as still finishing; `start` restarts it
    /// if it never was.
    case finishing
    /// More bytes than the file: a different file than the catalog pins.
    case oversize
  }

  static func partialState(partialBytes: Int64, expectedBytes: Int64) -> PartialState {
    if partialBytes <= 0 { return .empty }
    if partialBytes < expectedBytes { return .interrupted }
    if partialBytes == expectedBytes { return .finishing }

    return .oversize
  }

  static let interruptedDownloadMessage =
    "The download was interrupted. Retry to resume from where it stopped."

  // MARK: Loading

  struct AcceleratorPlan: Equatable {
    /// The backend to try first.
    let preferred: LocalLLMAccelerator
    /// `true` when a `gpu` request was answered with the CPU because the model does not list `gpu`.
    /// (A `gpu` init that fails at load time is a separate fallback, decided by the engine.)
    let downgradedFromGPU: Bool
  }

  /// Omitted → the model's first listed accelerator. A request the model does not list is answered
  /// with the CPU rather than refused: the persisted preference outlives the model it was chosen for.
  static func planAccelerator(
    requested: LocalLLMAccelerator?, supported: [LocalLLMAccelerator]
  ) -> AcceleratorPlan {
    let wanted = requested ?? supported.first ?? .cpu

    if supported.contains(wanted) {
      return AcceleratorPlan(preferred: wanted, downgradedFromGPU: false)
    }

    return AcceleratorPlan(preferred: .cpu, downgradedFromGPU: wanted == .gpu)
  }

  /// `enableThinking` only reaches the chat template for a model that has the capability.
  static func effectiveThinking(requested: Bool, capabilities: Set<LocalLLMCapability>) -> Bool {
    requested && capabilities.contains(.thinking)
  }

  /// Multi-token prediction runs only when the caller asked *and* the model file carries it — the
  /// runtime throws on `true` for a file without it, so the ask alone is never enough.
  static func effectiveSpeculativeDecoding(requested: Bool, fileSupports: Bool) -> Bool {
    requested && fileSupports
  }

  /// The hand-written intent tools bind only to a model whose chat template has tool-call slots.
  static func toolsToBind<T>(_ tools: [T], capabilities: Set<LocalLLMCapability>) -> [T] {
    capabilities.contains(.tools) ? tools : []
  }

  // MARK: Generating

  /// A call that carries images is refused, never trimmed to its text: answering a "what is in this
  /// photo?" prompt as if no photo had been attached is worse than saying no. No iOS model has the
  /// `vision` capability and this port does no image decoding.
  static func imageRejection(modelId: String?, imageCount: Int) -> LocalLLMError? {
    imageCount > 0 ? .imageInputUnsupported(modelId: modelId) : nil
  }

  // MARK: Tool results

  /// The most bytes of one tool result that go back into the model's context window.
  ///
  /// `contextTokens` is the KV cache (`LocalLLMLoadRequest.maxTokens`), and everything shares it: the
  /// system prompt and tool declarations (~500 tokens on Qwen3-0.6B), the question, the model's own
  /// tool call, this result, and the reply — reasoning included. A result that leaves no room for the
  /// reply leaves the model nothing to answer with.
  ///
  /// Half the window **in bytes**. JSON and English run ~3 bytes a token, so that is about a sixth of
  /// the window in tokens (≈170 of 1024): the fixed prompt keeps about half and the reply a quarter.
  /// An estimate, not a measurement — there is no tokenizer here and no device run has measured it —
  /// so it errs small; tune it on a device. The floor keeps a tiny window from rounding to nothing,
  /// the ceiling is the appliance's own cap on a tool result (`toolResultBudget.ts`).
  static func toolResultByteBudget(contextTokens: Int) -> Int {
    min(max(contextTokens / 2, 256), 16_384)
  }
}

// MARK: - Tool results

/// Bounds a tool's result before it goes back into the model's context window.
///
/// The appliance answers a tool call with the whole result, pretty-printed — 25 hydrated entities from
/// `knowledge.search` is ~40 KB of JSON, which its own chat harness measured and now bounds with
/// `boundToolResultForPrompt` (`backend/apps/api/src/domains/llm/toolResultBudget.ts`). On the phone
/// that text went straight into a 1024-token window already holding the system prompt and the tool
/// declarations — many times more than fits. How LiteRT-LM reacts to an input that large is what
/// ``GenerationFailure``'s logging is there to show; either way the model cannot answer from it.
/// This is that function's device twin, with the same shape of answer:
///
/// - a result that already fits is returned untouched;
/// - otherwise JSON is re-emitted compactly with each string capped, so one long message cannot eat
///   the budget, and each object's identifying fields (`type`, `link`, `title` …) written first so
///   that whatever a cut loses is prose, not the address of the thing;
/// - a search envelope (`{summary, …, items: […]}`) keeps its header whole and bounds only the list,
///   closing it with an element that says how many results were left out, so the text stays valid
///   JSON and the model knows the list was cut rather than exhaustive;
/// - anything else — not JSON, or JSON of another shape — is cut at the budget and says so.
///
/// Budgets are UTF-8 bytes, not characters: bytes are what a token budget is estimated from.
enum ToolResultShaper {
  /// Below this a budget cannot hold the markers, so it is raised to it.
  static let minimumBudgetBytes = 64
  static let truncationMarker = "…[truncated]"
  /// Held back from the list's budget so the closing "N more omitted" element cannot itself overflow.
  private static let omissionReserveBytes = 96

  static func shape(_ text: String, budgetBytes: Int) -> String {
    let budget = max(budgetBytes, minimumBudgetBytes)

    guard text.utf8.count > budget else { return text }

    guard
      let value = try? JSONSerialization.jsonObject(
        with: Data(text.utf8), options: [.fragmentsAllowed])
    else { return truncated(text, to: budget) }

    let capped = capStrings(in: value, to: min(max(budget / 5, 48), 320))
    let shaped: String?

    if let items = capped as? [Any] {
      shaped = json(boundItems(items, budget: budget))
    } else if let object = capped as? [String: Any], let items = object["items"] as? [Any] {
      shaped = envelope(object, items: items, budget: budget)
    } else {
      shaped = json(capped)
    }

    // A capped-but-broken tail beats an overflowed window, which loses the whole turn.
    guard let shaped else { return truncated(text, to: budget) }

    return shaped.utf8.count <= budget ? shaped : truncated(shaped, to: budget)
  }

  /// Cuts `text` to `budget` bytes, at a character boundary, ending in ``truncationMarker``.
  static func truncated(_ text: String, to budget: Int) -> String {
    guard text.utf8.count > budget else { return text }

    let room = max(0, budget - truncationMarker.utf8.count)
    var used = 0
    var kept = String.UnicodeScalarView()

    for scalar in text.unicodeScalars {
      let width = UTF8.width(scalar)
      guard used + width <= room else { break }
      kept.append(scalar)
      used += width
    }

    return String(kept) + truncationMarker
  }

  /// Caps every string in `value` at `cap` characters. A communication's `content` is unbounded; the
  /// model needs the gist and the identifiers, not the transcript.
  private static func capStrings(in value: Any, to cap: Int) -> Any {
    switch value {
    case let string as String:
      return string.count > cap ? String(string.prefix(cap)) + "…" : string
    case let array as [Any]:
      return array.map { capStrings(in: $0, to: cap) }
    case let object as [String: Any]:
      return object.mapValues { capStrings(in: $0, to: cap) }
    default:
      return value
    }
  }

  /// Whole leading items until the budget is spent, then an element naming how many were dropped. If
  /// even the first item is over budget, a cut-down preview of it stands in for the nothing the loop
  /// would otherwise keep: the model gets part of what it asked for.
  private static func boundItems(_ items: [Any], budget: Int) -> [Any] {
    var kept: [Any] = []
    var spent = 2  // the list's own brackets

    for item in items {
      let cost = (json(item) ?? "null").utf8.count + (kept.isEmpty ? 0 : 1)
      guard spent + cost <= budget - omissionReserveBytes else { break }
      kept.append(item)
      spent += cost
    }

    var consumed = kept.count

    if kept.isEmpty, let first = items.first {
      kept.append(preview(of: first, room: max(0, budget - omissionReserveBytes)))
      consumed = 1
    }

    let omitted = items.count - consumed

    if omitted > 0 {
      kept.append("[\(omitted) more results omitted — refine the query to narrow them down]")
    }

    return kept
  }

  /// `{"truncated": true, "preview": "<the item's JSON, cut>"}`, no bigger than `room` bytes once
  /// serialised — the cut text is escaped inside the string, so it is shortened until *that* fits,
  /// not just the text.
  private static func preview(of item: Any, room: Int) -> [String: Any] {
    let text = json(item) ?? "null"
    let limit = room - 30  // what `{"truncated":true,"preview":…}` leaves for the string
    var allowance = max(0, limit)
    var cut = truncated(text, to: allowance)

    while allowance > 0, let escaped = json(cut), escaped.utf8.count > limit {
      allowance = max(0, allowance - (escaped.utf8.count - limit))
      cut = truncated(text, to: allowance)
    }

    return ["truncated": NSNumber(value: true), "preview": cut]
  }

  /// A search envelope: the header fields whole — `summary` first, the one sentence a small model
  /// reads reliably — then `items`, bounded by whatever the header left.
  private static func envelope(_ object: [String: Any], items: [Any], budget: Int) -> String? {
    var header = object
    header["items"] = nil

    guard let members = members(of: header) else { return nil }

    let lead = "{" + members.map { $0 + "," }.joined() + "\"items\":"
    let room = max(0, budget - lead.utf8.count - 1)  // the closing brace

    guard let list = json(boundItems(items, budget: room)) else { return nil }

    return lead + list + "}"
  }

  // MARK: Writing JSON

  /// Compact JSON for a parsed value, or nil when it has none (a non-finite number).
  ///
  /// Written out here instead of through `JSONSerialization.data` for three reasons. Foundation
  /// prints 0.8123 as 0.81230000000000002, which costs tokens and reads as noise. It raises an
  /// Objective-C exception on a non-finite number, which Swift cannot catch. And it orders keys
  /// alphabetically, where ``members(of:)`` writes what identifies an object first and the rest
  /// shortest-first, so a cut that has to lose something loses long prose before the identifiers
  /// — `content` sorts ahead of `id`, `link` and `title`.
  private static func json(_ value: Any) -> String? {
    switch value {
    case let string as String:
      return quoted(string)
    case let array as [Any]:
      var elements: [String] = []

      for element in array {
        guard let text = json(element) else { return nil }
        elements.append(text)
      }

      return "[" + elements.joined(separator: ",") + "]"
    case let object as [String: Any]:
      return members(of: object).map { "{" + $0.joined(separator: ",") + "}" }
    case let number as NSNumber:
      return literal(number)
    case is NSNull:
      return "null"
    default:
      return nil
    }
  }

  /// Keys written ahead of every other, in this order. `summary` is the search envelope's one
  /// sentence, which a small model reads reliably; `type` and `link` are on every search hit (the
  /// appliance adds them) and `link` is the only address the model may hand the user; `title`,
  /// `name` and `subject` are what the entities call themselves.
  private static let leadingKeys = ["summary", "type", "link", "title", "name", "subject"]

  /// An object's members as `"key":value` text: ``leadingKeys`` first, then the rest shortest value
  /// first (ties by key). Nil when any value has no JSON form.
  private static func members(of object: [String: Any]) -> [String]? {
    var entries: [(key: String, size: Int, member: String)] = []

    for (key, value) in object {
      guard let name = quoted(key), let text = json(value) else { return nil }
      entries.append((key, text.utf8.count, "\(name):\(text)"))
    }

    func rank(_ key: String) -> Int { leadingKeys.firstIndex(of: key) ?? leadingKeys.count }

    entries.sort { lhs, rhs in
      if rank(lhs.key) != rank(rhs.key) { return rank(lhs.key) < rank(rhs.key) }

      return (lhs.size, lhs.key) < (rhs.size, rhs.key)
    }

    return entries.map(\.member)
  }

  /// A string as a JSON literal. Slashes stay as they are: `\/` costs a byte apiece in every link.
  private static func quoted(_ string: String) -> String? {
    guard
      let data = try? JSONSerialization.data(
        withJSONObject: [string], options: [.withoutEscapingSlashes])
    else { return nil }

    // Without the brackets that were added around it.
    return String(decoding: data.dropFirst().dropLast(), as: UTF8.self)
  }

  /// A number as a JSON literal: `true`/`false` for a boolean (identified by type — 1 and 0 are
  /// numbers), the shortest form that reads back for a double, nil for one JSON cannot carry.
  private static func literal(_ number: NSNumber) -> String? {
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }

    switch String(cString: number.objCType) {
    case "f", "d":
      let value = number.doubleValue

      return value.isFinite ? value.description : nil
    case "Q":
      return String(number.uint64Value)
    default:
      return String(number.int64Value)
    }
  }
}
