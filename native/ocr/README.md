# Dictol OCR

Standalone Node.js native addon for recognizing PNG screenshots. The package
entry loads only the current platform's `prebuilds/<platform>-<arch>/ocr.node`.

- `macos/` calls Apple Vision from Objective-C. Its Node-API addon runs OCR on a
  worker thread and also exposes `chineseWordRange` through NaturalLanguage.
- `windows/` calls `Windows.Media.Ocr` from Rust with napi-rs. Windows chooses a
  language from the user profile unless the caller specifies one.

The main process handles screenshot capture, text selection, sentence context,
and screen coordinates. Platform OCR implementations return recognized lines and
character boxes in the original normalized coordinate format.

Build macOS Intel and Apple Silicon on a Mac with `npm run build -- --target
x86_64-apple-darwin` and `npm run build -- --target aarch64-apple-darwin`.
Build Windows x64 on a Windows host with `npm run build -- --target
x86_64-pc-windows-msvc`. The root `npm run native:build` also builds OCR for the
current platform. Keep the resulting `.node` files in `prebuilds/` so a Node-only
checkout can start without a native toolchain.
