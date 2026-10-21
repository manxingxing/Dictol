# Dictol Screen Capture

Standalone Node.js native addon for capturing a display or a rectangle within a
display. Platform implementations live in separate native subprojects:

- `macos/` uses `screencapturekit` through its Rust API. On macOS 15.2 and
  later it captures the requested global rectangle directly; on macOS 14.0–15.1
  it selects the requested display and captures the equivalent display-local
  source rectangle.
- `windows/` uses Windows Graphics Capture with a GDI fallback and napi-rs.

The package entry selects `prebuilds/<platform>-<arch>/screen-capture.node`. Build
the current platform with `npm run build` from this directory. macOS target
architectures can be built on a Mac with `npm run build -- --target
x86_64-apple-darwin` or `aarch64-apple-darwin`. Build the Windows addon on a
Windows host with `npm run build -- --target x86_64-pc-windows-msvc`.
The build copies each addon into `prebuilds/` and removes the temporary `.node`
file generated inside the platform project.

The package exposes `getPermissionStatus()` and `openPermissionSettings()`.
On macOS, permission status uses Core Graphics preflight and the settings API
opens Screen Recording in System Settings. On Windows, status is `not-required`;
opening macOS settings rejects. The status is advisory: the application attempts
capture before treating permission as the cause of a failure.

The application keeps display selection, Electron DIP conversion, and Electron
fallback in `src/main/ocr/screen-capture.ts`.

The macOS app target is Sonoma (14.0) or later. The native addon converts the
captured `CGImage` to PNG and keeps the same `{ png, width, height }` result
shape used by the application layer.
