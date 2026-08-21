# Repair UX redesign

## Problem

The Repair workspace is feature-rich but exposes too many controls simultaneously. The interface mirrors internal implementation concepts more than the user's task.

Current capabilities are useful. The redesign goal is not to delete power; it is to reveal power only when it becomes relevant.

The intended user should not need to learn the software as if it were a general-purpose graphics editor before repairing a GPS track.

## Core principle: view first, edit second

Loading a recorded activity should open a normal **Activity View**.

This is not an editor by default.

The main screen should prioritize:

- route map
- ride summary
- charts
- sensor/statistics exploration
- GPS quality status
- detected GPS problems

Only after the user chooses a repair task should the interface enter a focused repair flow.

## Proposed top-level Activity View

A useful conceptual layout:

```text
Activity title / date
Distance · duration · elevation · average speed

[ Map ]

GPS quality
  ✓ No obvious issues
or
  ⚠ 2 suspicious sections
  [Show issues]

Charts
  Altitude
  Speed
  Heart rate
  ...future sensor charts
```

The precise visual design is open, but the information hierarchy is not: ride understanding comes before editing machinery.

## Entering repair

The user should start from a **problem**, not from an implementation operation.

Entry points:

### Automatically detected issue

Click a highlighted problem on the map or problem list.

Show a simple action:

`Repair this section`

The application preselects the detected range.

### Manual middle repair

Action:

`Select section manually`

Allow selection from the map and, where practical, from chart range selection.

The existing chart-selection behavior already returns coordinates for a selected profile range. This is valuable: selecting a suspicious speed/altitude/heart-rate interval should be able to highlight the same interval on the route and become a repair range.

### Broken start

Action:

`Repair start`

User-facing sequence:

1. Where did reliable GPS begin?
2. Where did the ride really begin?
3. Check the proposed replacement.
4. Apply.

Do not make "delete everything before cut point" the primary mental model, even if trimming samples remains part of the implementation.

### Broken end

Action:

`Repair end`

User-facing sequence:

1. Where did reliable GPS end?
2. Where did the ride really end?
3. Check the proposed replacement.
4. Apply.

## Repair is a guided workflow

Conceptual state machine:

```text
VIEW
  ↓
CHOOSE_PROBLEM
  ↓
SELECT_RANGE
  ↓
SHAPE_ROUTE
  ↓
REVIEW
  ↓
COMPLETE
```

Not every task must visit every state explicitly, but UI availability should be driven by a coherent repair session state.

## Step 1: Select range / boundaries

For detected issues:

- show the proposed range
- show clear A/B boundaries
- let the user adjust them directly

For manual issues:

- select start and end with map interaction or chart range
- provide immediate visual feedback

Existing operations such as:

- include earlier GPS drift
- include later GPS drift
- extend repair to next issue

should remain available, but not as permanent primary buttons. Prefer:

- draggable boundary handles, and/or
- a contextual `Fine tune boundaries` section

The common case should require little explanation.

## Step 2: Shape replacement route

Once boundaries are known, the application proposes replacement geometry.

Primary interactions should happen on the map:

- click the replacement route to add a shaping point
- drag a shaping point
- click a shaping point for contextual actions

The route itself should be the editor.

### Contextual waypoint controls

A selected point may expose a compact card/menu with actions such as:

- Delete point
- Previous segment: Follow roads / Direct
- Next segment: Follow roads / Direct

A permanent waypoint list/editor panel should not be required for ordinary repair.

### Off-grid/direct routing

Keep this feature. It is important for trails or unmapped sections.

However, treat it as a contextual/advanced operation. Examples:

- switch a selected leg to Direct
- enter a temporary `Draw direct section` mode

Do not show off-grid controls before a replacement route exists.

### Routing profile

Cycling/walking profile can remain available during route shaping, but it does not need to dominate the screen. A compact control is sufficient.

## Step 3: Review

Review should reduce editing controls and emphasize consequences.

Show:

- original geometry
- proposed repaired geometry
- changed distance / route-length difference
- repair quality warnings
- whether direct/off-grid segments are present
- clear indication that recorded sensor/time samples are preserved while GPS positions are repaired

Primary actions:

- `Back`
- `Apply repair`
- `Cancel`

Do not expose unrelated tools during review.

## After apply

Return to Activity View.

The repaired region may be marked subtly as edited. Detected-issue status should refresh.

Undo should remain obvious.

## Undo and history

The existing history machinery is useful, but a large permanent History panel is unnecessary for the normal workflow.

Prefer familiar global controls:

- Undo
- Redo, if implemented safely

Detailed repair history can live in a secondary menu/dialog.

Restore-original must remain available and clearly distinguishable from one-step Undo.

## Settings

Persistent preferences belong in a settings dialog/menu, not in the primary workflow.

Examples:

- map layer
- elevation correction behavior
- language/theme
- routing defaults

## Progressive disclosure rules

These are hard UX requirements for the redesign:

1. Do not show a control when the current task cannot use it.
2. Prefer direct manipulation on the map to a separate control panel when feasible.
3. Prefer user vocabulary (`repair start`, `repair this section`) to implementation vocabulary (`delete before`, `removed samples`).
4. Advanced capabilities may be hidden one level deeper; they must not be deleted merely to make the UI look simple.
5. Disabled controls should not become the main mechanism for explaining workflow. If a whole group is irrelevant, hide it.
6. The application should guide the next likely action.

## Internal-state refactor direction

The current repair workflow is represented by many independent state values (selected cut point, manual middle start, tail anchor, removed samples, rebuild direction, repair range, endpoint, via points, leg modes, map mode, active waypoint, etc.).

These values are legitimate implementation details, but they should be grouped behind a coherent `repairSession` abstraction.

Example direction (not mandatory schema):

```js
repairSession = {
  status: 'select-range' | 'shape-route' | 'review',
  type: 'middle' | 'start' | 'end',
  source: 'detected' | 'manual',
  range: { ... },
  endpoint: { ... },
  route: {
    viaPoints: [],
    legModes: {},
    preview: { ... }
  }
}
```

Prefer pure transition helpers such as:

```text
startDetectedRepair(...)
startManualRepair(...)
adjustRepairRange(...)
acceptRepairRange(...)
updateReplacementRoute(...)
beginRepairReview(...)
applyRepair(...)
cancelRepair(...)
```

This should make invalid combinations of UI state harder to represent.

## Component direction

Avoid continuing to grow `App.jsx`.

Likely extraction targets:

```text
ActivityView
GpsQualityCard
DetectedIssueList
RepairWorkspace
RepairRangeStep
RepairRouteStep
RepairReviewStep
RepairToolbar
WaypointContextCard
ActivityCharts
```

Names are illustrative. Prefer cohesive components over arbitrary file splitting.

## What must not regress

The redesign must retain:

- source-track recoverability
- exact/appropriate preservation of recorded sensor values
- start/end/middle repair
- manual range selection
- anomaly-driven repair
- direct/off-grid legs
- route shaping
- repair-quality checks
- draft recovery
- export
- chart exploration
- RU/EN

Simpler UI must not mean a less capable repair engine.

## Acceptance test for the redesign

A first-time user with a broken ride should be able to do this without reading a manual:

```text
Open ride
→ see that GPS has a problem
→ click the problem
→ click Repair
→ adjust the proposed route if needed
→ review
→ apply
```

For a problem the detector missed:

```text
Open ride
→ select suspicious interval on map/chart
→ Repair selected section
→ adjust route
→ review
→ apply
```

If the common path still requires understanding all repair controls simultaneously, the redesign has not achieved its goal.