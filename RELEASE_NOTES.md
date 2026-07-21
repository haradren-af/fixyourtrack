# FixYourTrack 0.83.0

This release adds a complete route-planning workspace and substantially hardens performance, local recovery, packaging, and the Repair interface.

Highlights:

- Create routes from scratch with start, finish, ordered waypoints, coordinate entry, off-grid sections, reverse, return-to-start, undo, and redo.
- Save named route projects locally, search and archive them, and recover safely from cross-window conflicts or interrupted writes.
- Restore validated route geometry offline and export planned routes as clean GPX route documents without invented activity data.
- Recalculate edited routes faster by batching provider requests, reusing unchanged route legs, isolating map-layer updates, and removing repeated large-track geometry/chart scans.
- Keep failed road-snapping legs visible and editable instead of making the entire route disappear.
- Close waypoint details by clicking elsewhere and keep the card inside the visible map area near screen edges.
- Use a compact, stable header whose recovery, error, activity, and saved states remain aligned in English, Russian, desktop, and mobile layouts.
- Harden local Windows and macOS servers, exact-revision release archives, checksums, dependency metadata, request limits, ordered draft persistence, emergency recovery, and browser security policy.
- Add deterministic browser, server, storage-failure, package, supply-chain, and release-asset verification.

See `CHANGELOG.md` for the complete list of changes and fixes.
