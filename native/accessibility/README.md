# Dictol Accessibility

Standalone Node.js native addon for reading text at a physical screen point.

The package exports the same API on macOS and Windows:

- `readAccessibleText(x, y, includeContext = false)` returns a word and its screen bounds,
  or a failure reason. With `includeContext: true`, the result also contains text
  and a UTF-16 offset into that text.
- `readAccessibleSelection(includeContext = false)` reads
  `selectedText` from the focused accessibility element. When requested and
  available, `text` and the UTF-16 `offset` of the selection are included;
  otherwise those two fields are omitted. An empty or unavailable selection
  returns `result: null` with a failure reason. Windows uses the first nonempty
  UI Automation selection range and returns its enclosing paragraph as context.
- With selection context enabled, macOS resolves `AXSelectedTextMarkerRange`
  through `AXUIElementForTextMarker` to the node containing the selection start.
  It measures the UTF-16 prefix within that node and reuses AI hover's text window,
  newline normalization and inline context expansion. Reverse selections are
  ordered first; repeated words are located by markers, not text search.
  If markers are unavailable, the existing focused-element range path remains
  available for native text controls. A selection spanning nodes receives context
  only when the expanded text contains the full selection at the resolved offset.
  `includeContext: false` continues to read selected text only.
  `AXSelectedTextRange` is queried only when marker resolution is unavailable.
  The marker attributes are implemented by
  [Chromium/WebKit](https://chromium.googlesource.com/chromium/src.git/+/d8ed539eb74b0c53ae82d975f491d4e2c9d52e85/ui/accessibility/platform/browser_accessibility_cocoa.mm)
  and may be unavailable in other applications.
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

On macOS, run the Accessibility fallback regression test with:

```sh
clang -fobjc-arc -fblocks native/accessibility/macos/checks/ax-fallback.m \
  -framework ApplicationServices -framework Foundation -framework NaturalLanguage \
  -o /tmp/dictol-ax-fallback-test && /tmp/dictol-ax-fallback-test
```
