# FixYourTrack 0.83.1

This patch fixes routed middle repairs for FIT activities whose distance counter freezes during GPS loss and catches up when the signal returns.

Highlights:

- Distribute repaired coordinates smoothly along the selected route instead of recreating a long diagonal from a delayed distance update.
- Preserve speed, distance, heart rate, cadence, power, temperature, timestamps, and the later reverse pass through the same road.
- Reject stale route previews after repair controls or routing settings change.
- Keep the original-track comparison layer hidden by default and expose it through an explicit map toggle.
- Add regression coverage for the affected FIT pattern and the complete browser repair workflow.

See `CHANGELOG.md` for the complete list of changes and fixes.
