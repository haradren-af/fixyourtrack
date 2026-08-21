# Codex working instructions: Activity Workspace redesign

This branch is an architecture/UX redesign branch. Do not preserve the current Repair UI merely because controls already exist. Preserve capabilities and data integrity, but redesign how those capabilities are exposed to users.

## Product direction

FixYourTrack and BikeHeatmap are converging into one local-first cycling activity application.

The target product has three top-level user concepts:

1. **Library / Archive** — all recorded activities, aggregate statistics, filters, density heatmap.
2. **Activity** — one recorded ride with map, charts, sensor data, statistics, GPS quality, and optional repair.
3. **Create Route** — the existing route-planning workspace.

A recorded activity should be imported once. The user must not repair/export/re-import a file just to make the archive and heatmap see the corrected version.

## Most important UX rule

The current Repair workspace exposes too many implementation-level controls simultaneously. Do not solve this by merely moving buttons, adding accordions, or changing CSS.

Use **progressive disclosure** and a task-oriented workflow:

- Normal state is **Activity View**, not "editor mode".
- Show map, useful ride statistics, charts, and detected GPS issues.
- Repair tools appear only after the user chooses a repair task.
- During repair, show only controls relevant to the current step.
- Advanced controls should appear contextually or behind an explicit advanced/details affordance.
- Technical implementation concepts (sample indexes, deleted samples, internal map modes, route leg objects) should not be exposed as primary user concepts.

## Repair workflow model

Treat repair as an explicit state machine rather than a collection of loosely related booleans.

Conceptual states:

- `view`
- `choose-problem`
- `select-range`
- `shape-route`
- `review`
- `complete`

Repair task types:

- detected middle GPS issue
- manually selected middle section
- broken start
- broken end

The exact implementation may evolve, but UI rendering should derive from a clear repair session/state object rather than exposing every control at once.

## Desired repair experience

### Activity View

Show:

- map
- core activity metrics
- charts
- GPS quality summary
- detected issue count and issue locations

Primary actions should resemble:

- `Repair this section`
- `Select section manually`
- `Repair start`
- `Repair end`

Do not make the user understand operations such as "delete before cut point" before they can repair a broken start.

### Range selection

For detected issues, preselect sensible boundaries.

For manual repair, allow selecting a range on the map and ideally from chart selection as well. Existing chart selection already maps a selected profile range back to coordinates; reuse this capability rather than inventing a second unrelated selection model.

Fine boundary adjustments should be contextual. Existing operations such as including earlier/later drift and extending to a following detected problem are valuable capabilities but should not be permanent top-level controls.

### Route shaping

Show the replacement route prominently on the map.

Default interaction should be direct manipulation:

- add a shaping point by interacting with the route
- drag points
- select a point for contextual actions

Do not keep a permanent standalone "Waypoint editor" panel unless strong evidence shows it is necessary.

Off-grid/direct routing is an advanced/contextual capability. It should be available when needed without competing with the primary repair flow.

### Review

Before applying, show a clear original-vs-replacement comparison and useful consequences such as route length change and repair quality warnings.

Primary actions:

- Back
- Apply repair
- Cancel repair

## Existing capabilities that must be preserved

Do not lose these while simplifying the UX:

- GPX and FIT import
- GPS anomaly detection
- middle-section repair
- broken start/end repair
- routed replacement geometry
- direct/off-grid sections
- draggable shaping points
- preservation of timestamps and recorded sensor values during coordinate repair
- speed, heart-rate, altitude charts
- chart range selection
- elevation correction on export
- undo / restore original
- local repair draft recovery
- GPX export
- RU/EN support
- Create Route workspace

## Undo/history

Undo should remain easy and globally available. A permanent large History panel is not a requirement. Prefer familiar undo/redo controls; detailed history can be secondary.

## Settings

Settings should not compete with the main repair workflow. Prefer a settings dialog/menu for persistent preferences.

## Data model direction for future BikeHeatmap integration

A recorded ride is one `Activity`, not a sequence of unrelated imported files.

Conceptually:

```text
Activity
  id
  metadata
  originalTrack
  activeTrack
  versions[]
  repairStatus
```

A repaired track is a new version of the same activity, not a duplicate activity.

The original recording must remain recoverable.

Do not implement destructive replacement as the only source of truth.

## Persistence direction

Long-lived user data should eventually live under a durable data/library location, not a directory named `.cache`.

Conceptual separation:

```text
data/
  activities/
  library.json

cache/
  density/
  remote-route-cache/
```

`data` is precious user data. `cache` must be safely rebuildable.

## Development strategy

Do not attempt the entire FixYourTrack + BikeHeatmap merger in one giant change.

Preferred sequence:

1. Refactor Repair into a task/state-driven UX without removing functionality.
2. Establish an Activity View as the normal mode for recorded tracks.
3. Introduce an activity/library API and durable activity-version model.
4. Allow FixYourTrack to open an activity by ID as well as from a file picker.
5. Save repaired versions back to that activity instead of requiring download/re-import.
6. Integrate aggregate library statistics and heatmap UI.

Each phase should remain testable and releasable.

## Coding constraints

- Keep repair math/data behavior separate from UI workflow state.
- Avoid making `App.jsx` even larger. Extract repair-session/state and task-specific UI components during the redesign.
- Prefer pure functions for repair-state transitions where practical and unit-test them.
- Preserve source track immutability/recoverability.
- Preserve sensor values during coordinate repairs.
- Do not silently discard data fields that are not currently visualized.
- Add tests for state transitions and for existing repair behavior before or alongside structural refactors.
- Do not perform broad visual redesign and deep data-model migration in the same unreviewable commit.

See `docs/REPAIR_UX_REDESIGN.md` and `docs/ACTIVITY_LIBRARY_INTEGRATION.md` for the fuller product intent.