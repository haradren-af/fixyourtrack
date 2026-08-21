# FixYourTrack 0.83.4

This patch makes repaired routes resilient to imperfect map data, external routing failures, and local-draft restoration.

Highlights:

- Apply a fully drawn repair exactly as shown even when a routing provider cannot confirm one of its sections.
- Snap routed user points to nearby mapped roads and paths without moving trusted FIT boundaries or manual off-grid sections.
- Fall back to pedestrian routing for mapped sidewalks and trails that cycling profiles reject.
- Restore saved road geometry faithfully and export a rebuilt beginning together with later middle repairs.
- Keep successful legs from a failed multi-waypoint request and show readable point numbers instead of internal waypoint identifiers.
- Add regression and browser coverage for manual fallback, draft recovery, composed export, and route retry behavior.

See `CHANGELOG.md` for the complete list of changes and fixes.
