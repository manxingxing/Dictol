# Dictol Accessibility

Standalone Node.js native addon for reading text at a physical screen point.

The package exports the same API on macOS and Windows:

- `readAccessibleText(x, y, includeContext)` returns the text, word range, screen
  bounds, and an optional failure reason.
- AI lookups pass `includeContext: true`: macOS can join adjacent inline
  Accessibility text nodes, while Windows returns the containing UI Automation
  paragraph for shared sentence extraction in the main process.
- macOS uses the Objective-C Accessibility bridge and a direct Node-API addon.
- Windows uses the existing Rust UI Automation implementation with napi-rs.

`index.js` loads the binary for `process.platform` and `process.arch`. The
application adapts the result to the shared hover-text interface in its main
process.

Build on macOS or Windows with `npm run build` from this directory. Build output
is written to `prebuilds/<platform>-<arch>/accessibility.node`. The root
`npm run native:build` command builds MDict and Accessibility for the requested
target; Windows cross-compilation remains orchestrated by
`scripts/build-native.mjs`.
