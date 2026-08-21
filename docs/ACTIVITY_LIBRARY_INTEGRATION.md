# Activity library and BikeHeatmap integration

## Goal

FixYourTrack and BikeHeatmap currently cover adjacent parts of one workflow:

```text
record ride
→ inspect/repair in FixYourTrack
→ export repaired GPX
→ import into BikeHeatmap
→ inspect aggregate statistics and heatmap
```

This double handling should disappear.

The target workflow is:

```text
record ride
→ import once
→ inspect activity
→ repair if needed
→ save
→ library statistics and heatmap update automatically
```

## Architectural principle

The central domain object is an **Activity**.

FixYourTrack's detailed track model and BikeHeatmap's archive metadata are two views of the same thing.

Conceptual model:

```text
Activity
  id
  metadata
  originalTrack
  activeTrack
  versions[]
  repairStatus
  source
```

The exact persisted schema may differ, but these invariants matter:

1. One recorded ride has one stable activity identity.
2. Repairing coordinates creates a version of that activity, not a second activity.
3. The original recording remains recoverable.
4. Aggregate statistics and heatmap consume the active version.
5. Detailed Activity View can access full samples and sensor data.

## Existing assets to reuse

### From FixYourTrack

- React/Vite UI
- MapLibre activity map
- detailed Track/sample model
- GPX/FIT parsing
- anomaly detection
- repair engine
- route shaping
- direct/off-grid routing
- charts and selected-range behavior
- sensor preservation
- draft/recovery behavior
- Create Route workspace

### From BikeHeatmap

- Express local server
- durable-ish local import flow for GPX/FIT
- duplicate detection
- Strava archive import
- Komoot supplement import
- Strava OAuth/API support
- aggregate activity metadata
- route-density engine
- aggregate filters/statistics
- heatmap rendering concepts

## Repository direction

Use FixYourTrack as the likely UI/application shell and bring BikeHeatmap server/data/density capabilities into the combined application incrementally.

Do not copy the current BikeHeatmap `public/app.js` wholesale into React. Reuse its behavior/data logic while rebuilding aggregate UI as React components when the merger reaches that stage.

## Import semantics

Current BikeHeatmap import treats a newly uploaded GPX/FIT as a new activity and correctly rejects likely duplicates.

That behavior should remain for **new imports**.

Repair saving requires a different semantic operation:

```text
POST /api/activities
```

creates/imports a new activity.

Conceptually:

```text
PUT /api/activities/:id/track
```

or a version-specific endpoint updates/adds an active repaired version for an existing activity.

Do not route repaired versions through duplicate detection as if they were unrelated new rides.

## Activity versioning

Suggested durable structure:

```text
data/
  activities/
    <activity-id>/
      metadata.json
      original.fit       # or original.gpx
      versions/
        repaired-001.gpx
        repaired-002.gpx
```

`metadata.json` may contain an `activeVersion` pointer plus computed summary information.

This is conceptual; implementation should consider migration safety and platform path handling.

Important: original files should not be overwritten by repair saves.

## Durable data vs cache

BikeHeatmap currently stores meaningful long-lived local data under `.cache`.

For a combined product, separate durable user data from rebuildable caches.

Target direction:

```text
data/
  activities/
  library.json

cache/
  density/
  strava-routes/
  other-rebuildable-derived-data/
```

Rules:

- deleting `cache` should never destroy the activity library
- deleting `data` is destructive and should never happen as cleanup

Migration from existing `.cache/strava-archive`, `.cache/local-fits`, and `.cache/local-gpx` must be explicit and tested before changing paths for real users.

## Full-sample retention

Aggregate heatmap metadata is not enough for Activity View.

The combined library must retain/access enough source data to reconstruct the detailed track:

- coordinates
- timestamps
- altitude
- speed
- heart rate
- cadence
- power
- temperature
- distance
- unknown/extensions where possible

Do not reduce imported files to only summary polyline + headline metrics if the original is available.

The original recording itself is the safest archival source of truth, supplemented by normalized metadata/indexes for fast browsing.

## Strava archive migration

The existing Strava ZIP importer currently reads activity files from the ZIP and extracts route geometry/summary metadata.

For a future unified library, a one-time import/migration should also preserve each relevant original FIT/GPX file as durable activity source data.

After successful durable import, daily use should not depend on repeatedly opening the original Strava export ZIP.

## Aggregate calculations

Heatmap and library statistics should consume `activeTrack` / active version geometry and summary metrics.

When a repair is applied:

1. save new activity version
2. recompute the activity summary affected by coordinate changes
3. invalidate density cache
4. update aggregate map/statistics

Do not require a manual export and re-import cycle.

## Statistics consistency

There are currently calculations in both projects (distance, speed, elevation, moving time, etc.). Before the final merger, define authoritative calculation rules so the same activity does not show contradictory values in Activity View vs Library.

Where a source file contains authoritative recorded/session values, preserve them deliberately. Where values are derived from geometry/time, centralize those derivations in shared modules.

Avoid silently changing historical aggregate statistics simply because UI code moved.

## Integration phases

### Phase 0 — Repair UX cleanup

Refactor FixYourTrack Repair into the task/state-driven Activity View + guided repair described in `REPAIR_UX_REDESIGN.md`.

Do this before adding library complexity to the current crowded Repair UI.

### Phase 1 — Activity identity and library API

Introduce a small local activity service capable of:

- list activities
- get activity metadata
- get original/active track
- import new FIT/GPX
- save repaired version
- restore original / change active version

Keep this narrow and testable.

### Phase 2 — Open library activity in Fix UI

Activity View should load either:

- an ad-hoc file (temporary/backwards-compatible mode), or
- a persisted activity by ID

The detailed Track model used by repair should be the same after loading.

### Phase 3 — Save repair to library

Add a primary action equivalent to `Save repair` for persisted activities.

Export-to-file remains useful, but it is no longer required to update the user's own library.

At this point the current painful double-import workflow is eliminated.

### Phase 4 — Aggregate library and heatmap in React shell

Bring BikeHeatmap's aggregate capabilities into the application:

- activity list
- filters
- year/month aggregate statistics
- route density heatmap
- activity selection from heatmap/list

Selecting an activity should open its Activity View directly.

### Phase 5 — source integrations

Keep/modernize optional imports:

- Strava archive
- Strava API where useful/allowed
- Komoot supplements
- standalone GPX/FIT

All sources ultimately create/update the same Activity library model.

## UX target after integration

Top-level navigation may look conceptually like:

```text
Library | Activity | Create Route
```

This is not a mandatory visual tab design, but it reflects the user mental model.

### Library

- heatmap
- aggregate stats
- filters
- activity list/search
- import

### Activity

- map
- charts
- sensors/stats
- GPS quality
- repair when requested
- original/repaired version status

### Create Route

- existing route planner, cleaned up independently as needed

## Non-goals for the first integration

Do not combine all of these into the first implementation step:

- complete UI redesign
- storage migration
- Strava OAuth changes
- heatmap rewrite
- repair-engine rewrite
- packaging rewrite

The first valuable milestone is simply:

```text
Import once → inspect → repair if needed → save → aggregate map sees it
```

Everything else can follow safely.