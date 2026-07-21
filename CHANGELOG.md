# Changelog

FixYourTrack uses [Semantic Versioning](https://semver.org/):

- Patch releases (`0.9.1`) contain fixes and small refinements.
- Minor releases (`0.10.0`) contain meaningful feature batches.
- Version `1.0.0` will mark the first stable release.

## 0.83.0 - 2026-07-21

### Added

- A fully isolated Create Route workspace with an accessible Repair/Create mode switch, start/finish placement, ordered waypoints, coordinate entry, route extension, reverse, return-to-start, undo/redo, and direct/off-grid tracing.
- Versioned named route projects with search, revision-safe autosave, duplicate, archive, restore, permanent delete, cross-window conflict recovery, and active-project restoration after restart.
- Offline restoration of validated resolved-route geometry tied to an exact route-plan fingerprint.
- Routing deadlines and budgets for controls, provider calls, response bytes, geometry, cache size, and total preview size.
- GPX route export with fixed decimal coordinates and deterministic 10,000-point output limit.
- Bundle-size budgets and high-severity dependency auditing in CI.
- Single-writer Create Route draft locking, ordered autosave draining, a bounded page-exit emergency journal, and explicit lock-loss recovery that preserves competing versions.
- Generated third-party notices and a CycloneDX SBOM in application packages and release assets.
- Automated package-server security tests and browser coverage for blocked storage, failed replacement uploads, modal focus, document language, and mobile touch targets.
- Clear warnings when local draft saving is unavailable, when replacing the active track, and when a track file exceeds the 50 MB safety limit.

### Changed

- Reduced route recalculation latency by batching consecutive road-following controls, reusing unchanged legs, debouncing edits, and bounding provider work.
- Removed large-track edit hot paths by updating only changed MapLibre sources, keeping charts on the applied track until repair confirmation, memoizing stable chart inputs and waypoint elevations, and replacing repeated route scans with cumulative-distance binary search.
- Bounded chart rendering and map highlighting with deterministic sampling that preserves selected endpoints.
- Reorganized the application header into stable control groups and a single prioritized feedback rail for recovery, errors, activity, and persistence state.
- Kept Repair and Create headers at the same compact desktop height, with responsive whole-group wrapping and 44-pixel mobile targets.
- Expanded the deterministic browser workflow to cover route planning, safe route export, Create/Repair state isolation, and project create/rename/archive/restore/open behavior.
- Coordinated shared-provider routing request starts per origin, enforced minimum request intervals, and bounded route caching and geometry-derived distance.
- Removed the anonymous elevation fallback and bounded terrain correction by operation/request deadlines, cancellation, response size, content type, and plausible elevation range.
- Made release publication a two-job, least-privilege process that builds and checks every asset, verifies checksums, publishes a draft, downloads it, and verifies it again before release.
- Made large repair drafts fail visibly instead of silently truncating track or active-repair data.
- Kept packaged launches on a deterministic local origin so browser drafts and preferences remain available between sessions.
- Updated the locked Vite and Babel toolchain to patched versions with no known npm audit vulnerabilities.
- Made the macOS package builder repair incomplete cached Go toolchains automatically.

### Fixed

- Kept a route visible and editable when a point cannot be snapped to a mapped or permitted road, while clearly marking the unresolved leg.
- Allowed waypoint details to close by clicking elsewhere and kept the details card inside the visible map viewport near every screen edge.
- Prevented long Repair status messages, saved-state labels, and localized action text from clipping without a full-text affordance.
- Prevented Vite development security policy from blocking the React refresh preamble and leaving a blank gray page; added a rendered-startup smoke check.
- Prevented header errors, export cancellation, and draft recovery from creating duplicate or unplanned extra rows.
- Prevented unsupported, corrupt, or temporarily unreadable Create Route drafts from being overwritten during startup.
- Prevented corrupt, future-version, and in-flight Repair drafts from being silently deleted or overwritten; explicit replacement now waits behind an ordered latest-wins save barrier.
- Preserved valid legacy Repair drafts that predate per-leg routing modes and rejected inconsistent middle-repair previews before they can reach rendering.
- Rejected lossy or malformed persisted route plans in both Create Route drafts and named projects, while preserving valid emergency journals when IndexedDB recovery fails.
- Prevented older in-flight draft saves, late saves from a previous project association, and stale cross-window writers from overwriting newer route state.
- Prevented archived projects from being renamed or saved and preserved both sides of project and draft conflicts for explicit recovery.
- Prevented stale routed geometry from becoming briefly exportable after a route edit.
- Preserved multi-word route-name entry and the current name across structural undo/redo.
- Preserved keyboard focus when a waypoint opens its map details and centered restored single-point drafts safely.
- Kept mobile route status overlays clear of map attribution.
- Preserved the current track when a replacement file fails to parse.
- Hardened GPX and draft validation, IndexedDB transaction completion, portable export filenames, and extreme-distance calculations.
- Added local-server Host validation, traversal protection, restrictive methods, missing-asset responses, browser security headers, version/revision health checks, server timeouts, and bounded Windows logs.
- Hardened macOS shutdown process selection and package ZIP finalization and verification.
- Bound and fully streamed every release ZIP entry during verification, and required both platform archives to match the exact current Git revision.
- Prevented fixed GPX coordinates near zero from being emitted in exponent notation and prevented large profile charts from exceeding JavaScript argument limits.
- Trapped and restored keyboard focus in the instructions dialog and enlarged small mobile controls.

## 0.82.0 - 2026-06-20

### Added

- Manual middle repair for GPS-loss sections that are not detected automatically: select two track borders and replace everything between them.
- A visible first-border marker while manually selecting a middle repair interval.
- Scenario-based in-app instructions for automatic middle repair, manual middle repair, off-grid sections, point editing, and export.
- Bidirectional off-grid controls in waypoint details for both the previous and following route sections.
- Route-quality fallback that avoids short routed spikes caused by routing services snapping to detached road geometry.

### Changed

- Off-grid instructions now describe section-side controls instead of treating a waypoint as globally off-grid.
- Manual middle-border selection no longer triggers automatic suspicious-segment repair while the user is choosing the second border.
- Browser smoke coverage now verifies both previous-section and following-section off-grid controls.

### Fixed

- Fixed cases where deleting or editing waypoints around off-grid sections could leave the route hard to return to a road-following shape.
- Fixed routed waypoint corrections that produced sharp unremovable out-and-back corners near buildings, paths, or disconnected mapped roads.

## 0.70.0 - 2026-06-11

### Added

- Per-section road-following and direct off-grid routing modes.
- Mixed routes that can leave mapped roads manually and resume road-following afterward.
- Numbered, draggable waypoint markers and compact waypoint details with coordinates, distance, and elevation.
- Waypoint controls for removal and toggling the following section between road-following and off-grid.
- A route-following insertion preview marker shown before creating a waypoint.
- Draft schema version 3 support for persisting section routing modes.
- Browser regression coverage for waypoint creation, dragging, mode switching, deletion, and insertion preview.

### Changed

- Kept waypoint details closed when creating or dragging a waypoint.
- Preserved each section's routing mode when inserting or moving waypoints.
- Reconnected surrounding points along mapped roads after deleting a waypoint.
- Removed the driving navigator profile; cycling and walking remain available.

### Fixed

- Prevented deletion of an off-grid waypoint from extending its direct routing mode across the newly joined gap.
- Prevented manual tracing from retaining references to deleted waypoints.
- Prevented routed waypoint corrections from producing short out-and-back spikes.

## 0.11.0 - 2026-06-10

### Added

- Routing retries and profile-aware fallback providers for cycling and walking.
- Draft schema migration, validation, and corruption recovery.
- Privacy-safe local crash diagnostics that exclude track and user data.
- Unit tests for repair, export, GPX parsing, routing, detection, drafts, and diagnostics.
- Stateful browser workflow tests for upload, charts, drafts, repair export locking, and export.
- GitHub CI checks for linting, unit tests, builds, and browser workflows.

### Changed

- Preserved sensor-only FIT records by interpolating repaired GPS positions during GPX export.
- Preserved distance, speed, heart rate, cadence, power, temperature, timestamps, and segment boundaries.
- Required start/end repairs to be explicitly applied or cancelled before export.
- Preserved exact repair borders instead of accepting routing-service endpoint snapping.
- Persisted active repair sessions in local drafts.
- Split the map, charts, and FIT parser into deferred bundles to reduce initial JavaScript loading.

### Fixed

- Detected short GPS-loss gaps containing sensor records even when border points are nearby.
- Corrected GPX speed extension compatibility.
- Prevented the Windows stop command from terminating unrelated processes referenced by stale PID files.
- Added timeouts and validation around routing and elevation requests.

## 0.10.5 - 2026-06-10

### Changed

- Added a dedicated Settings panel in the left workspace.
- Moved the interface-theme toggle, elevation-correction option, and version information out of the header.
- Added explanations for theme and elevation-correction settings.
- Visually separated actionable settings from version information.

## 0.10.0 - 2026-06-10

### Added

- Persistent light/dark theme toggle in the application header.
- Automatic operating-system theme preference on first use.
- Dark styling for application panels, controls, charts, status cards, and map-overlay controls.

### Changed

- Kept scheme and satellite map imagery unchanged when switching application themes.

## 0.9.0 - 2026-06-10

### Added

- Repair damaged middle sections by dragging the route between detected borders.
- Trim and rebuild damaged starts or ends of tracks.
- Routed, draggable, reorderable, and off-grid waypoints.
- Direct tracing for roads and trails missing from the map.
- Preservation of timestamps and recorded sensor data during middle repairs.
- Optional elevation correction during export.
- English and Russian interfaces.
- Resizable left workspace with responsive profile charts.
- Elevation, speed, and heart-rate profile cards with shared range selection.
- Live map highlighting for the range selected on a profile chart.
- Local repair drafts, repair history, and undo.
- Dependency-free Windows and macOS tester packages.

### Changed

- Replaced Leaflet with MapLibre GL JS.
- Simplified the interface around the GPS-track repair workflow.
- Added scheme and satellite map layers.
- Expanded suspicious GPS-loss borders to include nearby signal drift.
- Kept map position and zoom stable while editing routes and waypoints.

### Fixed

- Corrected middle-repair waypoint ordering when inserting points between existing waypoints.
- Fixed off-grid route behavior and start-point movement.
- Fixed map resizing, scrolling, and gray-background layout failures.
- Fixed elevation-service export failures.
- Fixed corrected sensor values appearing as flat averages in external services.
