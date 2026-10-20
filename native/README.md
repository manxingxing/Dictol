# Native projects

Native code is split by responsibility, with platform implementations inside each
functional project:

- `mdict-node` owns dictionary readers and writers and produces its own Node N-API addon.
- `accessibility` owns hover text lookup and produces its own Node N-API addon;
  `macos/` contains the Objective-C/Objective-C++ addon, and `windows/` contains
  the Windows UI Automation addon.
- `screen-capture` owns native display and region capture. Its macOS and Windows
  projects each produce a platform-specific Node N-API addon.

The application imports the native packages independently. Each build
produces a platform-specific `.node` file, and each platform build compiles only
its implementation. The application-facing TypeScript API stays in
`src/main/accessibility` and `src/main/screen-capture`.

OCR and selection panels remain in `mdict-node` for now; screenshot capture has
been extracted into `screen-capture`.

Build native addons for the current platform with `node scripts/build-native.mjs`.
Build an individual package with `npm --prefix native/accessibility run build` or
`npm --prefix native/screen-capture run build`. Windows native addons are built
on a Windows host.
