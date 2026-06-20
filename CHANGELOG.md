# Changelog

FixYourTrack uses [Semantic Versioning](https://semver.org/):

- Patch releases (`0.9.1`) contain fixes and small refinements.
- Minor releases (`0.10.0`) contain meaningful feature batches.
- Version `1.0.0` will mark the first stable release.

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
