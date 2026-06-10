# Changelog

FixYourTrack uses [Semantic Versioning](https://semver.org/):

- Patch releases (`0.9.1`) contain fixes and small refinements.
- Minor releases (`0.10.0`) contain meaningful feature batches.
- Version `1.0.0` will mark the first stable release.

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
