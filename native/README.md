# Native projects

- `mdict/` contains the Rust dictionary and DIDX core, CLI, and the
  `@dictol/mdict-native` Node package in one Cargo project. The `node` feature
  enables `src/binding.rs`; Rust-only builds keep the default feature set.
- `macos/` contains the macOS-only `@dictol/macos-native` panel addon.
  Objective-C implements AppKit behavior and Objective-C++ exposes Node N-API.
  Its loader defers binary loading until a panel function is called, so shared
  window-management code can import the package on Windows.
- `accessibility/` owns hover text lookup, with macOS Objective-C and Windows Rust implementations.
- `ocr/` owns capture and OCR, with macOS Objective-C and Windows Rust implementations.
- `system-translation/` retains the standalone Swift translation helper.

Build current-platform addons with `node scripts/build-native.mjs` or an individual
package with `npm --prefix native/mdict run build` / `npm --prefix native/macos run build`.
Build both macOS architectures using `--target aarch64-apple-darwin` or
`--target x86_64-apple-darwin`. macOS addons require the macOS toolchain.

Run dictionary binding tests with `npm run native:test`; run the panel integration
check on a macOS desktop with `node_modules/.bin/electron tests/native/macos/panel.cjs`.
All test scripts live in `tests/`.
