# Commercial Hardening Plan

This plan turns FixYourTrack from a tester utility into a dependable local-first product. A feature is complete only when its domain rules, failure behavior, accessibility, persistence, automated coverage, packaging, and documentation are complete together.

## Release principles

- Never replace or downgrade user data after a read, schema, quota, or concurrency failure.
- Never export stale, incomplete, or invented activity data.
- Keep Repair Track and Create Route documents isolated when switching modes.
- Treat the public map, routing, satellite, and terrain services as fallible external dependencies.
- Make every primary workflow usable with keyboard controls and at a 360 px viewport.
- Keep packaged servers bound to loopback with restrictive HTTP methods, traversal protection, and browser security headers.

## Execution status

### 1. Product modes and route creation — implemented

- Accessible Repair Track / Create Route switch in the header.
- Independent state and local drafts for both modes.
- Start, finish, ordered waypoints, route extension, reverse, and return-to-start controls.
- Road-following and direct/off-grid sections, including continuous direct tracing.
- Draggable map controls and exact coordinate entry for keyboard-only creation and editing.
- Undo/redo for route structure while preserving the current route name.
- Synchronous stale-preview invalidation and safe GPX route export without timestamps or sensor values.

### 2. Local projects — implemented

- Versioned IndexedDB project schema with atomic metadata/document transactions.
- Named route projects with search, active/archive views, open, rename, duplicate, archive, restore, and permanent delete.
- Revision-based optimistic concurrency. Conflicts preserve the open route and offer Reload or Save as copy; blind overwrite is not allowed.
- Current project ID and revision persist in the working route draft across restart.
- Future-schema and corrupt records remain preserved and read-only instead of being silently rewritten.
- Project data stays on the current device; cloud synchronization is not implied.

### 3. Reliability and resource budgets — implemented

- Draft hydration blocks editing until storage returns and never overwrites future or unreadable drafts.
- Each active Create Route draft has a single writer, enforced with Web Locks where available and a heartbeat-backed local lease fallback. Ownership is revalidated before writes.
- Autosaves use an ordered, coalescing drain so older in-flight writes cannot replace newer edits. A bounded synchronous emergency journal protects the newest unsaved state during page exit.
- Lock loss and project revision conflicts stop editing and provide explicit recovery choices. The non-selected version is quarantined instead of being silently discarded.
- Resolved route geometry is stored with its exact plan fingerprint, allowing a restored resolved draft to remain exportable offline.
- Dirty, saving, saved, error, and conflict states are explicit.
- Routing has whole-build, request, provider-call, response-byte, geometry-point, distance, cache, and control-count limits.
- Request starts to shared routing providers are coordinated per origin to respect a minimum interval, and route caching is bounded.
- Terrain correction has operation and request deadlines, cancellation, bounded responses, content-type validation, and plausible elevation limits.
- Only transient routing failures are retried; permanent responses and invalid geometry are not retried as if they were network faults.
- Planned GPX coordinates never use exponent notation; large geometry is deterministically capped with exact endpoints preserved.
- Oversized repair drafts fail visibly instead of being silently truncated.

### 4. Accessibility and responsive behavior — implemented, external audit pending

- Modal focus trapping and trigger focus restoration for Instructions and Projects.
- Inert background content while a modal is open.
- Keyboard-operable project tabs, search, inline rename, and inline destructive confirmations.
- Keyboard coordinate entry for every new route control and stable waypoint focus when opening map details.
- 44 px mobile controls, no 360–375 px horizontal overflow, and map overlays clear of attribution.
- Semantic map region and route/project status announcements.

### 5. Security, build, and distribution — implemented, signing pending

- Restrictive CSP and security headers in development and packaged local servers.
- Loopback-only fixed-origin packaged servers with Host, path, and method validation.
- Package launchers verify a version-and-revision health token. Server timeouts, request-header limits, and bounded local logs reduce resource-exhaustion risk.
- Dependency audit, generated-artifact checks, lint, unit tests, Windows and Go server tests, browser workflows, production builds, and bundle budgets are required in CI and release jobs.
- Generated third-party notices and a CycloneDX SBOM are checked for drift and included with package and release assets.
- Release assets are checksummed, staged as a draft, downloaded, and re-verified before publication. CI actions are commit-pinned and the build job has read-only repository permissions.
- Windows and macOS package build paths with deterministic startup and shutdown behavior.

## Required before a paid 1.0 release

1. Code-sign the Windows executable and launch scripts; sign and notarize the macOS package. Protect signing keys with an audited release-key process.
2. Replace community map, imagery, routing, and elevation endpoints with contracted services or self-hosted proxies. Define quotas, monitoring, failover, abuse controls, data locations, and retention terms.
3. Run independent WCAG 2.2 AA keyboard/screen-reader testing and an independent application-security assessment on supported Windows and macOS configurations.
4. Test IndexedDB quota, eviction, backup/export, and recovery with large real-world libraries in every supported browser.
5. Add signed build provenance/attestations, a vulnerability disclosure and response policy, dependency-update service levels, and a rehearsed rollback process. SBOM generation is already implemented.
6. Publish reviewed privacy, terms-of-use, licensing, and data-processing documentation naming every external coordinate processor and its retention terms.
7. Define supported OS/browser versions, support response targets, and a migration policy for every persisted schema.
8. For a paid native distribution, replace the shared fixed browser origin with an app-specific identity and move sensitive local state to OS-protected, application-scoped storage.

## Candidate enhancements after the hardened local release

- Optional account-based encrypted project sync with explicit conflict history.
- Project import/export bundles for backup and device transfer before cloud sync exists.
- Elevation profile and ascent estimates for planned routes, clearly identified as external estimates.
- Round-trip generation with target distance, direction, and surface preferences.
- Avoidance controls for ferries, unpaved roads, stairs, tolls, and unsafe cycling roads where provider data supports them.
- Route alternatives with distance and elevation comparison before selection.
- Project folders, tags, favorites, and recently opened filters.
- Offline map/routing packs with visible storage size and update controls.
- Installable PWA mode and explicit offline-capability status.
- Opt-in privacy-safe diagnostics with a user-visible event preview and no coordinates by default.

## Release gate

Every candidate release must pass:

```text
npm ci
npm run supply-chain:generate
npm audit --audit-level=high
npm run supply-chain:check
npm run lint
npm test
go test ./packaging/macos/server ./packaging/macos/zip
npm run test:server:windows
npm run test:dev:start
npm run check:bundle
npm run test:browser
git diff --check
```

Commit the versioned source and generated notices/SBOM after those checks. With an empty `git status --porcelain`, build and verify the revision-stamped release assets:

```text
npm run package:windows
npm run package:macos
npm run release:assemble
npm run release:verify
```

Package smoke tests and the independent checks above must be completed on clean supported Windows and macOS machines before a paid release is promoted.
