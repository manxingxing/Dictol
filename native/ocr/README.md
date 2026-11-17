# Dictol Screen Capture and OCR

Standalone Node.js native addon for screen capture and OCR. Platform implementations
live in separate native subprojects:

- `macos/` uses `screencapturekit` through its Rust API. On macOS 15.2 and
  later it captures the requested global rectangle directly; on macOS 14.0–15.1
  it selects the requested display and captures the equivalent display-local
  source rectangle. On macOS 13 it captures a single ScreenCaptureKit stream
  frame using the same display-local rectangle. Full-display and independent
  window capture use `SCScreenshotManager` on macOS 14+ and a single stream
  frame on macOS 13.
- `windows/` uses Windows Graphics Capture through `windows-capture` and napi-rs.
  Capture failures fall back to Electron at the application layer.

The package entry selects `prebuilds/<platform>-<arch>/screen-capture.node`. Build
the current platform with `npm run build` from this directory. macOS target
architectures can be built on a Mac with `npm run build -- --target
x86_64-apple-darwin` or `aarch64-apple-darwin`. Build the Windows addon with
`npm run build -- --target x86_64-pc-windows-msvc`; on non-Windows hosts this
uses `cargo-xwin` and the corresponding Windows SDK.
The build copies each addon into `prebuilds/` and removes the temporary `.node`
file generated inside the platform project.

The package exposes `getPermissionStatus()` and `openPermissionSettings()`.
On macOS, permission status uses Core Graphics preflight and the settings API
opens Screen Recording in System Settings. On Windows, status is `not-required`;
opening macOS settings rejects. The status is advisory: the application attempts
capture before treating permission as the cause of a failure.

On macOS, `captureScreenRegion(displayId, x, y, width, height)` accepts a
rectangle in global screen points contained in the specified display;
`captureDisplay(displayId)` captures a whole display; and
`captureWindow(windowId)` captures an independent window. IDs are Core Graphics
display and window IDs. Window capture uses the scale of the display with the
largest overlap and requires the window to overlap a display. All three return
`Promise<{ png: Buffer, width: number, height: number }>`; dimensions are pixels.
The cursor is excluded. Capture errors, unavailable IDs and invalid regions are
reported to the caller. macOS screen recording permission is required.

Windows exposes the same capture and listing method names. Display and window IDs
are hexadecimal `HMONITOR` and `HWND` strings, and bounds and region coordinates
are global physical pixels. The display list can include a name; the window list
includes the title and available owning process information. The application
maps Electron DIP coordinates to these native coordinates before capture.
Windows captures one WGC frame per request. Regions are copied from the frame's
GPU texture into a smaller CPU-readable texture. The cursor is hidden when the
Windows version supports configuring cursor capture; otherwise WGC's default
applies. WGC requires Windows 10 version 1903 or later.

On Windows, set `DICTOL_SCREEN_CAPTURE_INTEGRATION=1` when running `npm test` to
exercise display and region capture. Set `DICTOL_SCREEN_CAPTURE_WINDOW_ID` to a
window ID returned by `listShareableWindows()` to also exercise window capture.

On macOS, `listShareableDisplays()` returns display IDs and bounds. `listShareableWindows()`
returns on-screen windows intersecting a display, with their IDs, bounds, layer,
visibility, and, when available, title and owning application (process ID,
name and bundle identifier). Bounds use global screen points. These lists are
snapshots, and listing a target does not guarantee that a later capture succeeds.
The lists are asynchronous and may fail if ScreenCaptureKit cannot retrieve the
content, including due to permissions.

The application keeps display selection, Electron DIP conversion, and Electron
fallback in `src/main/ocr/native-ocr-capture.ts` and `screen-capture.ts`.

The macOS native addon targets macOS 13.0 or later and returns PNG data in the
same `{ png, width, height }` result shape on each supported version. This does
not by itself establish the minimum supported macOS version of the whole app.

The addon also recognizes PNG input with `recognizeMacText` or `recognizeWindowsText`.
For screen OCR, `captureAndRecognizeMacText` and `captureAndRecognizeWindowsText`
capture and recognize in one native task without encoding a PNG. Their result
contains an opaque snapshot usable with `recognizeMacSnapshot` or
`recognizeWindowsSnapshot` for further crops of the same frame. Crop rectangles
are normalized relative to the snapshot. Call `releaseMacSnapshot` or
`releaseWindowsSnapshot` as soon as the snapshot is no longer needed. In-flight
recognition retains its own reference; garbage collection is a fallback if the
caller does not explicitly release it.
`ScreenCaptureError` identifies capture-stage failures so the caller can fall back
to Electron and PNG OCR. Native logs report capture and recognition times separately.
