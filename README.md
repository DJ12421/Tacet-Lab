# Tacet Lab

Tacet Lab is a local-first Wuthering Waves collection manager, Echo scanner, and team damage calculator. It runs in the browser, keeps account data on the device, and never interacts with the game process or automates game input.

**[Open Tacet Lab](https://dhruvj12421.github.io/WuWa-Optimizer/)**

Tacet Lab is a fan-made project and is not affiliated with Kuro Games.

## Getting started

1. Open the site in a current version of Chrome or Edge on Windows.
2. Add owned characters and weapons from the bundled catalog.
3. Add Echoes by sharing the Wuthering Waves window, importing a screenshot, or entering their stats manually.
4. Review every scanned field before saving the Echo.
5. Equip weapons and Echoes, then inspect team rotations and expected damage for the currently supported calculation roster.

Use the top-bar controls to export or restore a JSON backup. Open **Settings & data** to change local preferences or erase the browser's local data.

## Current features

- Browse the Nanoka 3.5 character, weapon, Sonata, and Echo catalogs.
- View Nanoka's animated Spine portrait on character loadout cards, with a static-art and reduced-motion fallback.
- Track owned characters, weapon copies, levels, sequences, ranks, locks, and assignments.
- Scan English Echo detail screens from a user-approved window share.
- Import PNG, JPEG, or WebP screenshots, with manual entry as a fallback.
- Review and correct identity, cost, rarity, level, Sonata, main stat, and substats before saving.
- Search, filter, grade, lock, exclude, edit, equip, and delete locally stored Echoes.
- Build five-Echo, 12-cost character loadouts and connect them to three-member teams.
- Inspect Nanoka-derived normal, average, and critical results for every generated character attack, with saved team conditions and calculation traces.
- Author timestamped actions and advanced custom buffs for deterministic formula-driven rotation damage.
- Optimize one character's Echoes against the live team scenario with level, rarity, main-stat, Sonata, equipment-source, main-Echo, and stat constraints; a dynamic worker pool skips provably irrelevant branches, exact searches retain a completeness guarantee, and capped searches are labeled best found.
- Compare ranked loadouts in an interactive build-distribution chart, inspect main-Echo placement and swap plans, borrow disclosed Echoes from saved builds, and restore compatible local optimizer profiles and runs.
- Export and restore versioned account backups as JSON.
- Install the site as a PWA after opening it in a supported browser.

## Privacy and network access

There are no accounts, backend services, analytics, telemetry, cloud sync, image uploads, audio capture, or game-process access.

```text
WuWa window -> browser MediaStream -> local crop -> local English OCR
            -> review queue -> IndexedDB
```

Window sharing starts only after the browser permission prompt. Stopping the share ends every media track. Screenshots and captured frames are processed locally and are not persisted unless the reviewed Echo is saved.

The app downloads catalog artwork and the selected character's animated portrait assets from Nanoka. It may also download the Tesseract worker, WebAssembly runtime, and English language model on the first OCR run. Previously requested OCR resources and built app assets are cached for later use. See [docs/privacy.md](docs/privacy.md) for the complete boundary.

## Important limitations

- OCR supports the English game UI only.
- Live scanning is designed for 1920x1080 and 2560x1440 16:9 layouts on desktop Chrome or Edge.
- Mobile supports browsing and editing, but not live game-window capture.
- Real 1080p and 1440p fixtures have not yet demonstrated the 95% OCR target. Every result must be reviewed.
- Formula coverage is pinned to `nanoka-3.5-formula-v2`: 60 characters, 120 weapons, 34 Sonatas, and 180 Echoes are classified, and generated character attack parameters drive the result sheets.
- “Nanoka-derived” means reproducible from that pinned dataset, not independently verified against the current English in-game UI. Complex weapon, Sonata, sequence, and Echo-active behaviors must retain visible reference/coverage warnings until their structured effects are audited.
- Catalog images and animated character portraits require a network connection unless the browser already cached them. The first OCR run also requires network access.

## Local development

Requirements: Node.js 22 or later and npm.

```powershell
npm install
npm run dev
```

The development server runs on localhost, which is a secure browser context and supports window sharing. Other hostnames require HTTPS.

Run the project checks with:

```powershell
npm run typecheck
npm test
npm run build
```

The production output is written to `dist/`. GitHub Actions runs the same checks before deploying pushes to `main` through GitHub Pages.

## Documentation and data sources

- [Architecture](docs/architecture.md)
- [Privacy boundary](docs/privacy.md)
- [Game-data verification policy](docs/game-data.md)
- [OCR fixture and acceptance protocol](docs/ocr-fixtures.md)

Catalog metadata and artwork are imported from [Nanoka 3.5](https://ww.nanoka.cc/) with permission. Echo main-stat validation references the Wuthering Waves Wiki. The generated catalog records their source URLs and generation metadata in the repository.

Do not use current damage output as an authoritative in-game reference, and do not claim the OCR accuracy target without the required fixture corpus.
