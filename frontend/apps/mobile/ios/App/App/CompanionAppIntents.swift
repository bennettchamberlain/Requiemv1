import AppIntents
import Foundation

// Native App Intents that expose Companion's core actions to Siri, Spotlight, and the
// Shortcuts app. Each runs outside the webview and talks to CI-Server directly via
// `CompanionAPI` (Keychain API key). Gated to iOS 16+ (the framework's minimum); the
// app itself still supports iOS 15, where these simply aren't offered.

@available(iOS 16.0, *)
struct AskCompanionIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Companion"
    static var description = IntentDescription(
        "Ask your Companion a question and get a spoken answer.",
        categoryName: "Companion"
    )
    // Runs in the background and replies with a dialog rather than opening the app.
    static var openAppWhenRun = false

    @Parameter(title: "Question", requestValueDialog: "What would you like to ask?")
    var question: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask Companion \(\.$question)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let api = try CompanionAPI.make()
        let answer = try await api.ask(prompt: question)

        return .result(dialog: IntentDialog(stringLiteral: answer))
    }
}

@available(iOS 16.0, *)
struct SearchMemoryIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Memory"
    static var description = IntentDescription(
        "Search your Companion memory and hear how many results matched.",
        categoryName: "Companion"
    )
    static var openAppWhenRun = false

    @Parameter(title: "Search", requestValueDialog: "What should I search for?")
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Search Companion memory for \(\.$query)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let api = try CompanionAPI.make()
        let (count, titles) = try await api.search(query: query)

        let dialog: String
        if count == 0 {
            dialog = "I didn't find anything for “\(query)”."
        } else {
            let plural = count == 1 ? "result" : "results"
            let preview = titles.isEmpty ? "" : " Top matches: \(titles.joined(separator: ", "))."
            dialog = "I found \(count) \(plural) for “\(query)”.\(preview)"
        }

        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

@available(iOS 16.0, *)
struct RememberIntent: AppIntent {
    static var title: LocalizedStringResource = "Remember"
    static var description = IntentDescription(
        "Save a note to your Companion memory.",
        categoryName: "Companion"
    )
    static var openAppWhenRun = false

    @Parameter(title: "Note", requestValueDialog: "What should I remember?")
    var content: String

    static var parameterSummary: some ParameterSummary {
        Summary("Remember \(\.$content) in Companion")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let api = try CompanionAPI.make()

        // Use a short first-line excerpt as the title; keep the full text as content.
        let firstLine = content.split(whereSeparator: \.isNewline).first.map(String.init) ?? content
        let title = String(firstLine.prefix(60))
        let saved = try await api.createNote(title: title, content: content)

        return .result(dialog: "Saved “\(saved)” to your memory.")
    }
}

@available(iOS 16.0, *)
struct OpenCompanionIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Companion"
    static var description = IntentDescription("Open the Companion app.", categoryName: "Companion")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        .result()
    }
}

@available(iOS 16.0, *)
struct CompanionShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        // Note: Siri phrases can only interpolate `\(.applicationName)` (and
        // AppEntity/AppEnum parameters) — a free-text String parameter can't appear in a
        // phrase, so these stay parameter-free; Siri prompts for the question/query via
        // each intent's `requestValueDialog` when invoked.
        AppShortcut(
            intent: AskCompanionIntent(),
            phrases: [
                "Ask my \(.applicationName)",
                "Ask \(.applicationName) a question",
            ],
            shortTitle: "Ask Companion",
            systemImageName: "bubble.left.and.bubble.right"
        )
        AppShortcut(
            intent: SearchMemoryIntent(),
            phrases: [
                "Search my \(.applicationName) memory",
                "Search \(.applicationName)",
            ],
            shortTitle: "Search Memory",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: RememberIntent(),
            phrases: [
                "Remember this in \(.applicationName)",
                "Add a note to \(.applicationName)",
            ],
            shortTitle: "Remember",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: OpenCompanionIntent(),
            phrases: ["Open \(.applicationName)"],
            shortTitle: "Open Companion",
            systemImageName: "globe"
        )
    }
}
