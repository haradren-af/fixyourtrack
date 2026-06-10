# FixYourTrack

Local browser tool for repairing GPS tracks after signal loss, GPS drift, spoofing, or coordinate jumps.

Current tester version: **0.10.0**

## Tester Package

Stable latest-download links for testers:

- [Download FixYourTrack for Windows](https://github.com/haradren-af/fixyourtrack/releases/latest/download/FixYourTrack-Tester-Windows.zip)
- [Download FixYourTrack for macOS](https://github.com/haradren-af/fixyourtrack/releases/latest/download/FixYourTrack-Tester-macOS.zip)

The `release` branch publishes these files as a GitHub Release. Development changes do not reach testers until they are intentionally merged or pushed to that branch with a new version number.

Testers do not need Node.js, Python, or additional libraries. They extract the complete folder and double-click the included Start file. The macOS package supports both Apple Silicon and Intel Macs.

## Main Features

- Import GPX and FIT tracks.
- Detect suspicious GPS losses and coordinate jumps.
- Repair middle sections between fixed borders.
- Trim and rebuild a damaged start or end.
- Shape replacement routes using draggable waypoints.
- Trace roads or trails missing from the map.
- Preserve timestamps, heart rate, speed, cadence, power, altitude, and other recorded sensor values during middle repairs.
- View speed, heart-rate, and altitude charts.
- Export repaired tracks to GPX.
- English and Russian interface.
- Persistent light and dark application themes without changing the map layer.

## Development

```bash
npm install
npm run dev
```

Checks:

```bash
npm run lint
npm run build
```

Build the tester package:

```bash
npm run package:windows
npm run package:macos
```

Or double-click the matching `Build-Windows-Package.cmd` or `Build-macOS-Package.cmd` on the Windows development machine.

## Versioning And Releases

FixYourTrack uses Semantic Versioning while under active development:

- `0.9.1`: fixes and small refinements.
- `0.10.0`: meaningful feature batch.
- `1.0.0`: first stable release.

Update `package.json`, `CHANGELOG.md`, and `RELEASE_NOTES.md` before promoting a commit to the `release` branch. The release workflow rejects a version that was already published.

## Privacy And Limitations

- Track files and drafts stay in the browser.
- Public map, routing, and terrain services receive coordinates required for their features.
- Routing, satellite imagery, and elevation correction require internet access.
- Export currently supports GPX only.

---

# FixYourTrack на русском

Локальное браузерное приложение для исправления GPS-треков после потери сигнала, дрейфа GPS, спуфинга или скачков координат.

Готовый архив для тестировщиков:

`release/FixYourTrack-Tester-Windows.zip`

Тестировщикам не нужны Node.js, Python или дополнительные библиотеки. Нужно полностью распаковать папку и дважды нажать `Start FixYourTrack.cmd`.
