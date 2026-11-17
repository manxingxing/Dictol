**Comparison Target**

- Source visual truth (dark): `/Users/manxingxing/.codex/generated_images/019fd333-1c16-7173-883d-d2365c0e99a6/exec-154a0d22-17b7-4f90-8dc4-4918d53876ac.png`
- Source visual truth (light): `/Users/manxingxing/.codex/generated_images/019fd333-1c16-7173-883d-d2365c0e99a6/exec-00dc547d-f1ea-4464-89c4-3e386cf8760f.png`
- Intended implementation: active dictionary pill in `src/renderer/src/pages/SearchResultPage.tsx`
- Intended viewport: desktop dictionary tab row, 900 × 220 px reference component
- Intended states: active pill in light and dark colour schemes

**Implementation Evidence**

- No usable browser-rendered implementation screenshot is available.
- The native module built successfully and `npm run dev` started Electron with the renderer on `http://localhost:5175/`.
- The in-app browser runs in an isolated network environment and could not reach that local renderer (`ERR_CONNECTION_REFUSED`).
- A host-screen capture confirmed that the Electron window opened, but GPU composition errors left its content as an unusable background rather than the rendered application UI.
- Source formatting, diff validation, and targeted lint for `SearchResultPage.tsx` passed.

**Findings**

- [P1] Browser-rendered comparison unavailable.
  Location: local Electron development environment.
  Evidence: the application started, but the isolated browser cannot reach its renderer and the host Electron window has GPU composition errors.
  Impact: liquid-glass opacity and shadow balance cannot be visually compared against the selected references.
  Fix: capture active tabs in dark and light modes from a host with working Electron GPU composition (or expose the renderer to the browser QA environment), then compare them with the two source images.

**Focused Region Comparison**

Blocked. The active-pill region could not be captured from a rendered implementation.

**Comparison History**

1. Initial attempt: local application startup failed before the Vite server became reachable.
2. Follow-up: the native module compiled and Electron started on port 5175. Browser access was isolated from that port; host capture showed Electron GPU composition errors, so neither colour scheme could be reviewed.

**Final Result**

final result: blocked

---

# Editorial workspace shell, bundled font, and chrome tones — 2026-08-13

**Comparison Target**

- Source visual truth: `opendesign/mockups/dictol-editorial-workspace/dictol-editorial-workspace.html` in its light macOS state.
- Source capture: `/private/tmp/dictol-design-reference-current.png`.
- Implementation captures: `/private/tmp/dictol-font-qa.png`, `/private/tmp/dictol-theme-neutral-font.png`, and `/private/tmp/dictol-theme-moss-font.png`.
- Combined comparison inputs: `/private/tmp/dictol-titlebar-font-comparison.png` and `/private/tmp/dictol-theme-font-comparison.png`.
- Intended implementation: 44 px continuous platform titlebar, 30 px controls, IBM Plex Sans for application chrome, source-controlled MDX typography, neutral default chrome tone, and optional moss chrome tone.

**Implementation Evidence**

- The application shell resolved `IBM Plex Sans Variable` at weight 400, and the loaded `FontFace` reported status `loaded` in the running Electron renderer.
- `electron-vite` emitted six IBM Plex Sans variable WOFF2 subset assets. The unpacked `dist/mac/Dictol.app/Contents/Resources/app.asar` contains those emitted assets and does not contain the Fontsource development package.
- The unpacked Electron application loaded the bundled font from `app.asar`; no network font dependency was required.
- At 1051 × 662, the measured titlebar height was 44 px and the compact search control height was 30 px.
- Compact titlebar search opened its native popover at 384 × 135, focused the search input, preserved the `serendipity` query, and rendered two real dictionary suggestions. Both the trigger and popover input computed to no visible box shadow.
- Neutral mode computed the titlebar and navigation rail to `rgb(245, 245, 242)`; moss mode computed both to `rgb(232, 235, 223)`. Both selectors expose `aria-pressed`, persist through `dictol:app-preferences`, and the final state was restored to neutral.
- The light-mode muted foreground was adjusted to `#687168`, giving a 4.63:1 contrast ratio on the neutral rail and 5.01:1 on the content surface.
- TypeScript checks, targeted ESLint, Prettier checks, the production renderer build, native build, and unpacked Electron application build all passed.

**Full-view Comparison**

- Passed for the application-owned shell, titlebar continuity, navigation rail, workspace dividers, icon alignment, neutral/moss surfaces, and settings presentation.
- The dictionary article body was excluded from typography matching because its fonts and layout are owned by the active MDX dictionary.
- The normal workspace keeps search in the left search panel; compact mode moves it into the titlebar. This is an intentional product-state difference from the always-visible titlebar search in the design mockup.

**Focused Region Comparison**

- Passed for the titlebar and first workspace row using the 1051 × 110 combined crop.
- The implementation is denser than the source mockup in the dictionary-tab/icon row because it renders the real configured dictionary set. The previously accepted overlap between `AHD双解` and the online-dictionary icon group at constrained widths is expected behavior and is not a finding.
- Passed for the neutral/moss selector comparison at 1051 × 662. Only the app-owned frame colors change; layout and MDX content styling remain stable.

**Required Fidelity Surfaces**

- Fonts and typography: passed for application chrome; MDX body intentionally source-controlled.
- Spacing and layout rhythm: passed for the 44 px titlebar, 30 px controls, navigation rail, panel boundaries, and compact search popover.
- Colors and tokens: passed after the muted-foreground contrast correction; neutral remains the default.
- Image quality and asset fidelity: passed; the existing Dictol icon and installed dictionary icons remain real assets with no placeholder or CSS-art substitution.
- Copy and content: passed for app-owned labels and descriptions; dictionary and AI result content are dynamic.
- Icons: passed for titlebar, navigation, settings, dictionary toolbar, and AI panel controls in the inspected states.
- States and interactions: passed for neutral/moss selection, persistence, compact-mode entry/exit, compact-search open/focus/suggestions/dismiss, and AI panel visibility in the supplied current-state screenshot.
- Accessibility: passed for visible focus, semantic buttons, `aria-pressed` theme state, focused combobox behavior, disabled back control, and AA contrast of application-owned light surfaces.
- Viewport resilience: passed at 900 × 670, 980 × 675, and 1051 × 662 for the inspected app-owned shell. The accepted dictionary-tab/icon overlap is documented above.

**Findings**

- No unresolved P0, P1, P2, or P3 findings in this QA scope.

**Comparison History**

1. The first pass found that the CSS named IBM Plex Sans without shipping the font and that muted text missed AA contrast on the neutral rail.
2. The font was self-hosted through the official Fontsource variable package, imported globally for all renderer entry points, and moved to a build-time dependency so only emitted WOFF2 assets are packaged.
3. The muted foreground was darkened without changing layout or the accepted palette direction.
4. Post-fix production, unpacked-package, runtime-font, theme-state, compact-search, and focused visual comparisons all passed.

**Final Result**

final result: passed

---

# AI lookup configuration modal — 2026-08-12

**Comparison Target**

- Source visual truth: `/Users/manxingxing/projects/vibe-coding/Dictol/opendesign/mockups/ai-config-modal/ai-config-modal-prompt.jpg`
- Source pixels: 1280 × 720 at 1× density.
- Intended implementation: AI lookup configuration dialog in `src/renderer/src/pages/SettingsPage.tsx`.
- Intended viewport: 1280 × 720 desktop window.
- Intended states: connection tab, Prompt tab, and keyboard-focused tab trigger.

**Implementation Evidence**

- Implementation screenshot: unavailable.
- The Electron renderer started at `http://localhost:5174/`, but direct browser access cannot reproduce the Electron preload bridge required by the application shell.
- A scoped preload substitute was attempted in the QA tab; the browser blocked the required pre-navigation script and Vite rejected a later dynamic remount, so that page was not used as visual evidence.
- Capturing the whole host screen was rejected because it could include unrelated sensitive content; no screenshot was taken.
- Node and web TypeScript checks, targeted ESLint, diff validation, and the Electron Vite production build passed.

**Full-view Comparison**

Blocked. The source design is available, but there is no trustworthy rendered implementation capture at the matching viewport.

**Focused Region Comparison**

Blocked for the same reason. Code-level checks confirm a 768 px desktop maximum width, two equal-height tab panels, parallel Prompt textareas, a body-only scroll region, and a green focus-visible ring, but these are not substitutes for rendered evidence.

**Findings**

- [P1] Rendered comparison unavailable.
  Location: Electron-only renderer environment.
  Evidence: the source mockup is visible, while browser-direct rendering fails without `window.dictol` and no safe app-window-only screenshot was captured.
  Impact: final typography, spacing, token rendering, and modal fit cannot be visually compared against the selected design.
  Fix: open Settings → AI lookup → Configure in the running Electron app and capture only the Dictol window at 1280 × 720, then compare both tabs with the source mockup.

**Required Fidelity Surfaces**

- Fonts and typography: blocked pending rendered evidence.
- Spacing and layout rhythm: blocked pending rendered evidence.
- Colors and visual tokens: blocked pending rendered evidence.
- Image quality and asset fidelity: no image assets are used in this modal; the remaining icon/control rendering is blocked pending rendered evidence.
- Copy and content: verified in source; both distinct default Prompt values and the two-tab labels are present.

**Comparison History**

1. The selected mockup was verified at 1280 × 720 before implementation; the initial variant exposed modal-height and tab-focus differences.
2. The implementation added equal 19 rem tab-body minimums and an explicit Dictol green focus-visible ring, then passed code and build checks.
3. Browser-direct implementation capture remained unavailable because the renderer requires Electron preload APIs; no post-fix rendered comparison was accepted.

**Final Result**

final result: blocked

---

# Current QA status — 2026-08-13

The latest scoped report is **Editorial workspace shell, bundled font, and chrome tones — 2026-08-13** above. The older blocked sections are retained as historical QA records for different components and do not override the current shell/font/theme result.

**Final Result**

final result: passed
