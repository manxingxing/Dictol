import AppKit
import Foundation
import NaturalLanguage
import SwiftUI
import Translation

private struct TranslationInput: Decodable {
    let text: String
    let sourceLanguage: String
    let targetLanguage: String
}

private struct TranslationOutput: Encodable {
    let text: String?
    let detectedSourceLanguage: String?
    let error: String?
}

private struct TranslationView: View {
    let input: TranslationInput
    let finish: (TranslationOutput) -> Void

    private var source: Locale.Language? {
        let identifier = input.sourceLanguage == "auto"
            ? detectSourceLanguage(input.text) : input.sourceLanguage
        return identifier.map(Locale.Language.init(identifier:))
    }

    var body: some View {
        Text(" ")
            .translationTask(
                source: source,
                target: Locale.Language(identifier: input.targetLanguage)
            ) { session in
                do {
                    let response = try await session.translate(input.text)
                    finish(.init(
                        text: response.targetText,
                        detectedSourceLanguage: response.sourceLanguage.languageCode?.identifier,
                        error: nil
                    ))
                } catch {
                    finish(.init(
                        text: nil,
                        detectedSourceLanguage: nil,
                        error: error.localizedDescription
                    ))
                }
            }
    }
}

private func detectSourceLanguage(_ text: String) -> String? {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    guard let language = recognizer.dominantLanguage,
          let confidence = recognizer.languageHypotheses(withMaximum: 1)[language],
          confidence >= 0.4 else { return nil }
    let identifier = language.rawValue.hasPrefix("zh") ? "zh" : language.rawValue
    return ["zh", "en", "ja", "ko", "fr", "de"].contains(identifier) ? identifier : nil
}

@MainActor
private final class TranslationApplication: NSObject, NSApplicationDelegate {
    private let input: TranslationInput
    private var window: NSWindow?
    private var finished = false

    init(input: TranslationInput) {
        self.input = input
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: -2000, y: -2000, width: 100, height: 100),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentView = NSHostingView(rootView: TranslationView(input: input, finish: finish))
        window.alphaValue = 0
        window.orderFront(nil)
        self.window = window
    }

    private func finish(_ result: TranslationOutput) {
        guard !finished else { return }
        finished = true
        write(result)
        NSApplication.shared.terminate(nil)
    }
}

private func write(_ result: TranslationOutput) {
    guard let data = try? JSONEncoder().encode(result) else { return }
    FileHandle.standardOutput.write(data)
}

@main
private struct Program {
    @MainActor
    static func main() {
        do {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let input = try JSONDecoder().decode(TranslationInput.self, from: data)
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            let delegate = TranslationApplication(input: input)
            app.delegate = delegate
            app.run()
        } catch {
            write(.init(text: nil, detectedSourceLanguage: nil, error: "系统翻译请求无效。"))
        }
    }
}
