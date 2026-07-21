# FixYourTrack

Local-first browser tool for repairing recorded GPS tracks and planning new GPX routes.

Current tester version: **0.83.0**

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
- Switch between independent Repair Track and Create Route workspaces.
- Create a route from a start, finish, exact coordinates, and draggable waypoints.
- Mix road-following and direct/off-grid sections, reverse a route, or return to the start.
- Save named local route projects; search, rename, duplicate, archive, restore, and permanently delete them.
- Export standards-compliant GPX routes without inventing timestamps, speed, heart rate, or other recorded activity data.

## Development

```bash
npm install
npm run dev
```

On Windows, `powershell -ExecutionPolicy Bypass -File .\Start-FixYourTrack.ps1` starts the development server, verifies that React rendered without browser-console errors, and only then opens the page.

Checks:

```bash
npm audit --audit-level=high
npm run supply-chain:check
npm run lint
npm test
npm run test:server:windows
go test ./packaging/macos/server ./packaging/macos/zip
npm run test:dev:start
npm run check:bundle
npm run test:browser
```

Build the tester package:

```bash
npm run package:windows
npm run package:macos
npm run release:assemble
npm run release:verify
```

Release archives embed their source revision. Generate and commit the supply-chain artifacts, keep the worktree clean, and only then run the package commands; verification rejects stale, uncommitted, or dirty archives.

Or double-click the matching `Build-Windows-Package.cmd` or `Build-macOS-Package.cmd` on the Windows development machine.

## Versioning And Releases

FixYourTrack uses Semantic Versioning while under active development:

- `0.9.1`: fixes and small refinements.
- `0.10.0`: meaningful feature batch.
- `1.0.0`: first stable release.

Update `package.json`, `CHANGELOG.md`, and `RELEASE_NOTES.md`, then run `npm run supply-chain:generate` before promoting a commit to the `release` branch. The release workflow rejects a version that was already published.

## Privacy And Limitations

- Track files and drafts stay in the browser.
- Named projects are stored only in this browser profile on this device. There is no cloud sync or automatic backup.
- Create Route uses single-writer draft locking, ordered autosaves, and a bounded emergency journal. Lock loss or revision conflicts require an explicit recovery choice instead of silently overwriting a version.
- Public map, routing, and terrain services receive coordinates required for their features.
- Shared routing requests are rate-limited and cached within fixed budgets. Terrain responses and deadlines are bounded; no anonymous fallback elevation provider is used.
- Routing, satellite imagery, and elevation correction require internet access.
- A previously resolved Create Route draft keeps validated route geometry for offline review/export. New routing or route changes still require internet access.
- Export currently supports GPX only.
- Individual GPX/FIT files are limited to 50 MB to keep browser memory use predictable.
- Planned-route export is capped at 10,000 route points while preserving its exact first and last points.

The repository includes hardened local servers, release verification, third-party notices, and a CycloneDX SBOM. A paid release still requires contracted or self-hosted coordinate providers, application-specific native identity and OS-protected storage, platform signing/notarization and signed provenance, reviewed legal/privacy terms, and independent accessibility and security testing.

The detailed execution and 1.0 release criteria are in [COMMERCIAL_HARDENING_PLAN.md](COMMERCIAL_HARDENING_PLAN.md).

---

# FixYourTrack на русском

Локальное браузерное приложение для исправления записанных GPS-треков и создания новых GPX-маршрутов.

Готовые архивы для тестировщиков:

- [FixYourTrack для Windows](https://github.com/haradren-af/fixyourtrack/releases/latest/download/FixYourTrack-Tester-Windows.zip)
- [FixYourTrack для macOS](https://github.com/haradren-af/fixyourtrack/releases/latest/download/FixYourTrack-Tester-macOS.zip)

Тестировщикам не нужны Node.js, Python или дополнительные библиотеки. Полностью распакуйте папку и запустите включённый Start-файл.

В режиме «Создать маршрут» можно поставить старт и финиш, добавить и перетащить точки, совместить прокладку по дорогам с прямыми участками и сохранить именованный проект локально. Экспорт создаёт GPX-маршрут без выдуманных данных времени и датчиков.

Файлы, черновики и проекты остаются в профиле браузера на текущем устройстве. Облачной синхронизации и автоматической резервной копии пока нет. Карты, прокладка маршрута, спутниковые снимки и коррекция высоты могут передавать необходимые координаты внешним сервисам и требуют интернета.
