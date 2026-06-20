# FixYourTrack 0.82.0

This release focuses on manual control when automatic detection misses a GPS-loss section, and on making mixed road/off-grid editing more predictable.

Highlights:

- Manually repair a middle section even when it is not listed in the repair queue.
- Select two track borders, then replace everything between them with the normal blue editable route.
- Keep a visible first-border marker while choosing the second manual repair border.
- Switch either the previous or following section of a waypoint between road-following and off-grid.
- Avoid short routed spikes caused by map-routing services snapping to disconnected road geometry.
- Updated English and Russian instructions to describe the actual repair scenarios.
- Expanded browser smoke checks for bidirectional off-grid waypoint controls.

See `CHANGELOG.md` for the complete list of changes and fixes.
