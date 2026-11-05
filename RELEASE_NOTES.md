# FixYourTrack 0.84.0

This release adds recording-gap recovery, preserves recorded FIT statistics, and makes incomplete personal-trail repairs easier to finish.

Highlights:

- Recover gaps left when recording was stopped, preserving surviving records and explicitly marking reconstructed portions without creating sensor readings.
- Retain recorded FIT session statistics through coordinate repairs, GPX round trips, and saved drafts.
- Move repair borders along the recorded track and adjust the track date/time while preserving intervals and sensors.
- Show exactly which points lack a personal-trail connection and offer an explicit manual line for that section, preserving the rest of the route.
- Improve distance and chart handling for missing GPS samples, cadence summaries, and reconstructed time.
- Update vulnerable dependencies and the map renderer. The map now requires a browser/device with WebGL2 support.

Local source installations also support routing along recorded BikeHeatmap rides. This integration requires the Vite development/preview server and a local archive; the Windows and macOS tester packages do not include the archive service or personal track data.

See `CHANGELOG.md` for the complete list of changes and fixes.
