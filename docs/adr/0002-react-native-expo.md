---
status: accepted
date: 2026-10-16
---

# React Native + Expo for the RecipeBox 2.0 client

Four options were evaluated for the native client required by ADR 0001:
React Native + Expo, SwiftUI with a separate Android implementation, Flutter,
and Capacitor as a baseline. **Recommendation: React Native + Expo.**

The deciding factor is the import pipeline. RecipeBox's recipe-import
intelligence lives in eight UMD JavaScript modules under `public/` —
`recipe-extract`, `recipe-normalize`, `recipe-grounding`, `recipe-schema`,
`recipe-tags`, `nutrition`, `shopping-list`, `recipe-library` — totalling
**2,358 lines with zero DOM references, zero network calls and zero external
dependencies**, each covered by its own regression script. This is the code
behind a measured 98.9% import pass rate over the 100-case nightmare suite, and
it is the most expensive engineering asset in the project.

React Native runs those modules **unchanged**. SwiftUI and Flutter would require
either reimplementing them in Swift/Dart — re-earning that pass rate from
scratch, twice in the SwiftUI case — or forcing every import through the server,
which breaks offline import and adds latency to the app's most-used feature.

## Considered options

- **React Native + Expo (recommended).** Reuses the domain logic verbatim and
  one UI codebase covers both platforms. Expo supplies the native capabilities
  Cook Mode and import need (`expo-keep-awake`, `expo-haptics`,
  `expo-notifications`, `expo-image-picker`, `expo-sqlite`, `expo-file-system`).
  Claude Code works well in this stack. Cost: a JS bridge sits under the UI, so
  the most demanding animations need care, and some web libraries
  (jsPDF, pdf.js, heic2any) need native replacements.
- **SwiftUI + separate Android.** Best-in-class iOS feel, but it means two
  entirely separate UI codebases plus a port of the shared domain logic, and it
  makes Android a second project rather than a second target. Rejected on cost
  and on the Android commitment in ADR 0001.
- **Flutter.** Excellent rendering and one codebase, but Dart cannot run the
  existing JavaScript domain modules at all, so the import pipeline must be
  rewritten or centralised server-side. Rejected for the same reason as SwiftUI,
  without SwiftUI's compensating iOS polish.
- **Capacitor/WebView (baseline).** Cheapest and fastest; explicitly rejected by
  ADR 0001.

## Consequences

- The shared modules must be extracted into a versioned package consumed by both
  the web app and the native client (see ADR 0003), not copy-pasted.
- **Reuse is a claim to be tested, not assumed.** The shared package must run its
  existing regression scripts against the React Native runtime (Hermes) in CI
  before any native feature depends on it. Hermes is not a browser and not Node;
  "pure JavaScript" is necessary but not sufficient evidence.
- Web-only dependencies need native equivalents: PDF export, PDF page
  rendering for imports, HEIC decoding, and canvas-based image compression.
- The React 18 UMD globals pattern (`window.RecipeBoxExtract`) must become real
  module imports.
