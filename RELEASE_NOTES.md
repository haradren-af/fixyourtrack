# FixYourTrack 0.11.0

This release hardens track repair and export, improves routing resilience, and adds automated verification.

Highlights:

- Preserve sensor-only FIT records by assigning repaired GPS positions during GPX export.
- Preserve timestamps, distance, speed, heart rate, cadence, power, temperature, and GPX segments.
- Explicitly apply or cancel start/end repairs before export.
- Resume active repair sessions from validated local drafts.
- Use profile-aware cycling and walking routing with retries and fallback providers.
- Preserve exact repair borders instead of accepting router endpoint snapping.
- Recover safely from malformed drafts and show privacy-safe local crash diagnostics.
- Load the map, charts, and FIT parser only when needed for faster startup.
- Run unit, production-build, and stateful browser workflow checks in CI.
- Run dependency-free tester packages on Windows, Intel Macs, and Apple Silicon Macs.

See `CHANGELOG.md` for the complete list of changes and fixes.
