# @dictol/macos-native

macOS panel addon. `src/selection_panel.m` owns AppKit windows and view reparenting;
`src/addon.mm` validates Node inputs, forwards events through a thread-safe callback,
and releases panels and callbacks on environment teardown. All panel calls require
the main thread. The Electron BrowserWindow keeps ownership of its WebContents.

Build: `npm --prefix native/macos run build` (macOS 13+, arm64/x64).
Integration check: `node_modules/.bin/electron tests/native/macos/panel.cjs`.
Run this check after upgrading Electron. Panel configuration relies on
Electron's private `ElectronNSPanel` class and reports the Electron version
when policy configuration fails.
