# FixYourTrack 0.70.0

This release replaces waypoint-level off-grid behavior with explicit per-section routing controls and makes route shaping substantially easier.

Highlights:

- Mix road-following and direct off-grid sections within the same repaired route.
- Resume road-following automatically after manually tracing an off-grid section.
- Preserve a section's routing mode while moving its waypoint.
- Reconnect surrounding points along mapped roads when deleting a waypoint.
- Use numbered, draggable waypoint markers with distance, elevation, removal, and section-mode controls.
- Preview waypoint insertion with a marker that follows the route under the pointer.
- Keep waypoint details closed while creating or dragging points.
- Restrict navigator profiles to cycling and walking.
- Preserve section routing modes in local repair drafts.
- Verify the complete waypoint and off-grid workflow with automated browser tests.

See `CHANGELOG.md` for the complete list of changes and fixes.
