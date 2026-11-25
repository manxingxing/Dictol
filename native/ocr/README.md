# Dictol Screen Capture and OCR

Standalone Node.js native addon for screen capture and OCR. Platform implementations
live in separate native subprojects:

- `macos/` uses Objective-C ScreenCaptureKit, Vision, and NaturalLanguage APIs,
  with an Objective-C++ Node-API binding built by clang. On macOS 15.2 and
  later it captures the requested global rectangle directly; on macOS 14.0–15.1
  it selects the requested display and captures the equivalent display-local
  source rectangle. On macOS 13 it captures a single ScreenCaptureKit stream
  frame using the same display-local rectangle. Full-display and independent
  window capture use `SCScreenshotManager` on macOS 14+ and a single stream
  frame on macOS 13.
- `windows/` uses Windows Graphics Capture through `windows-capture` and napi-rs.
  Display, region, and window capture accept a final `engine` argument: `gdi`
  (default) or `wgc`. The selected engine never falls back to the other engine.
  GDI uses BitBlt for displays/regions and PrintWindow for windows. WGC creates
  one session per request and stops it after one frame. Windows does not use
  Electron capture fallback.

The package entry selects `prebuilds/<platform>-<arch>/ocr.node`. Build
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
When WGC is selected, Windows captures one frame per request. Regions are copied from the frame's
GPU texture into a smaller CPU-readable texture. The cursor is hidden when the
Windows version supports configuring cursor capture; otherwise WGC's default
applies. WGC requires Windows 10 version 1903 or later.

On Windows, set `DICTOL_SCREEN_CAPTURE_INTEGRATION=1` when running `npm test` to
exercise display and region capture. Set `DICTOL_SCREEN_CAPTURE_WINDOW_ID` to a
window ID returned by `listShareableWindows()` to also exercise window capture.

On macOS, `listShareableDisplays()` returns display IDs and bounds. `listShareableWindows()`
returns on-screen windows intersecting a display, excluding desktop windows,
with their IDs, bounds, layer, visibility, and, when available, title and owning application (process ID,
name and bundle identifier). Bounds use global screen points. These lists are
snapshots, and listing a target does not guarantee that a later capture succeeds.
The lists are asynchronous and may fail if ScreenCaptureKit cannot retrieve the
content, including due to permissions.

The application keeps display selection and Electron DIP conversion in the main
process capture adapters. Native capture errors propagate without Electron fallback.

AI context lookup uses `captureMacOcrImage` / `captureWindowsOcrImage` to retain
one native screenshot and return an image handle with pixel dimensions.
`image.recognize(region, language)` crops and recognizes raw pixels; `null`
recognizes the full retained image. Regions use integer pixels relative to the
image's top-left corner. macOS accepts a language array; Windows accepts one
language tag or `undefined`. Node decides whether to retry the full image.
No PNG or pixel Buffer crosses the native boundary on this path.

Call `image.dispose()` in `finally` after each lookup. Disposal is idempotent,
and new recognition calls reject after disposal. Each asynchronous task retains
its own image reference, so disposing the handle does not invalidate queued OCR.
Windows uses `Arc<RawFrame>` and row copies for cropping; macOS uses retained
`CGImageRef` objects and `CGImageCreateWithImageInRect`. Rust drop / the Node-API
finalizer releases the handle's image as a GC fallback. No global image registry
or persistent capture session is used.

The macOS native addon targets macOS 13.0 or later and returns PNG data in the
same `{ png, width, height }` result shape on each supported version. This does
not by itself establish the minimum supported macOS version of the whole app.

The addon also recognizes PNG input with `recognizeMacText` or `recognizeWindowsText`.
All macOS OCR entry points always enable automatic language detection in Apple Vision.
On macOS 13+, `captureAndRecognizeMacText(displayId, x, y, width, height, languages)`
captures a region and passes its CGImage directly to Vision in one native task.
Coordinates are global screen points contained in the specified display. It returns
`{ observations, width, height }`, with image dimensions in pixels. No PNG or image
handle crosses the Node boundary; the task owns and releases the image.
Normal macOS hover lookup uses this method. Only capture-stage failures carry
`code: 'ERR_SCREEN_CAPTURE'`. Capture and OCR errors propagate directly without
switching capture backends. Normal macOS lookup captures up to 1000×300 screen points. AI context
lookup retains a display-width × 600-point native image and first recognizes a crop
of two-thirds display width × 450 points. When more context is needed, it recognizes
the entire retained image without another capture. Regions are clamped
to their available bounds.

Windows dictionary hover lookup uses `captureAndRecognizeWindowsText` in
`windows/src/capture_ocr.rs`. The capture module offers both PNG output and an
internal `RawFrame` BGRA8 image consumed directly by OCR. The combined task returns
`WindowsOcrResult` directly and releases the native image after recognition.
No PNG encoding, decoding, or pixel transfer through Node occurs on this path.
The optional `language` argument selects the OCR language; omitting it uses
Windows user language preferences. The final `engine` argument selects `gdi`
or `wgc` and is passed to the capture module unchanged. Both raw-image and PNG OCR
preserve the input dimensions. Only images exceeding `min(OcrEngine.MaxImageDimension, 3200)`
are proportionally reduced with bilinear interpolation; images are never enlarged.
Windows hover lookup, AI context lookup, and
screenshot translation share the Windows-only OCR language setting. No automatic
language retry runs. Screenshot translation retains its PNG API.
On both platforms, AI context lookup retains a display-width
× 600-DIP native image and crops a two-thirds-width × 450-DIP image in native code.
If recognition misses or incomplete context touches the crop edge, it recognizes
the original image once more. Both passes return only OCR results, and the handle
is disposed in `finally` after the lookup. The AI
capture geometry and expansion decisions are shared in `src/main/ocr/ai-ocr.ts`.
The Windows-only OCR settings include a capture engine, defaulting to GDI for
new and existing configurations. Hover lookup, AI context lookup, and screenshot
translation read the settings once at the start of each operation and pass the
engine through Node to native capture. Retries keep the same engine. Failures
propagate without changing engines. macOS does not read or apply this setting.

PNG results on both platforms contain only `{ png, width, height }`.

Screenshot translation captures the selected region as PNG, shows recognition
progress, and passes that PNG to the platform OCR API. The progress window appears
after capture, so it does not enter the recognized image. Capture and OCR are
separate calls; the addon keeps no image handle between them.
Native phase logs include a timestamp, process ID, request ID, and operation name.
Vision logs share the worker's thread marker and distinguish recognition from
character-box conversion. `worker-finished` precedes the JS completion callback;
`promise-resolved` records result delivery to JS. No recognized text is logged.

To compare OCR in Node and Electron with a synthetic image (without screen access),
run `node tests/native/ocr/macos-ocr-probe.cjs` from the repository root, or pass
the same script to the local Electron executable.

The macOS build requires a macOS SDK with the 15.2 rectangle capture API.
Runtime availability checks select the appropriate capture path; deployment targets
below 13.0 are unsupported. OCR runs on Node's worker pool and releases the decoded
CGImage before returning the recognition result.

Run `node --test tests/native/ocr/macos-native.test.cjs` from the repository root
for deterministic native capture and PNG OCR tests without screen permission.
For a real Electron check of PNG capture followed by progress and OCR, run the local
Electron executable with `tests/native/ocr/macos-progress-capture.cjs`. It uses
synthetic target and progress windows, checks one-shot region OCR, and verifies
PNG OCR must recognize the captured target even
after a progress window covers it on screen.
Live capture tests require Screen Recording permission and
`DICTOL_SCREEN_CAPTURE_INTEGRATION=1`; macOS 13, 14, and 15.2+ should each be
checked on their respective systems, including Retina and multiple displays.

### macOS migration validation

The Objective-C migration has been built for arm64 and x64 with deployment target
13.0. Both binaries weak-link `SCScreenshotManager`, and the build rejects
unguarded use of newer APIs. On the current macOS 27.2.1 host, live display/window
listing, full-display capture, independent-window capture, region capture,
and PNG export have passed.
The native frame-receiver test also checks incomplete-frame filtering, pixel
ownership after the source buffer is changed/released, and late stream errors.
This exercises the macOS 13 receiver on the current host, not the macOS 13 runtime.

To run live acceptance tests on macOS 13, 14, and 15.2+ with Screen Recording access:

```sh
DICTOL_SCREEN_CAPTURE_INTEGRATION=1 npm --prefix native/ocr test
```

The permission preflight is advisory. If the system returns a TCC denial despite
preflight reporting access, the live test must be rerun after correcting system
permission; the denial does not count as a successful capture test.
macOS 13/14 runtime acceptance and mixed-scale/multiple-display acceptance remain
pending until those environments are available. x64 is build-verified only.
