# Architecture

## Runtime boundaries

Tacet Lab is a static React application. It has no server runtime.

```text
Screen share / screenshot / local video
  -> resolution and layout calibration profile
  -> stable frame sampler and fingerprint gate
  -> OffscreenCanvas preprocessing worker
  -> named field regions
  -> adaptive English Tesseract scheduler pool and visual classifiers
  -> candidate validation and local duplicate detection
  -> typed review candidate with field evidence
  -> explicit user approval
  -> Dexie / IndexedDB
  -> pure calculation modules
  -> partitioned optimizer Web Workers
  -> React views and local PNG/JSON exports
```

## Modules

- `src/domain/` owns serializable types, the tagged formula graph, calculation contexts and traces, stat aggregation, rotations, buffs, and optimization. Domain functions do not access the DOM or storage.
- `src/game-data/` owns the pinned Nanoka 3.5 display and numeric source data. `src/domain/calculation/sheets.ts` classifies every generated character, weapon, Sonata, and Echo record for formula coverage.
- `src/scanner/` owns local capture sources, calibration profiles, named field regions, worker preprocessing, the adaptive English OCR pool, session cancellation/backpressure, parsing, validation, duplicate detection, diagnostics, and fixture accuracy/performance accounting.
- `src/storage/` owns IndexedDB tables, seed repair, schema validation, optimizer profiles and run history, atomic import, export, and reset.
- `src/workers/` isolates partitioned optimization from the render thread and reports aggregate progress to the UI. Scanner image preprocessing runs in `src/scanner/preprocess.worker.ts`; Tesseract workers are serialized through one-worker schedulers managed by `OcrPool`.

## Scanner privacy and ordering

Captured images, videos, field crops, OCR text, and diagnostic evidence remain in browser memory. Calibration profiles are stored in local storage and approved Echoes continue to use IndexedDB. Diagnostic reports omit images unless the user explicitly chooses the image-inclusive action.

Text-field preprocessing is clean-room and WuWa-specific. Named regions are padded, enlarged, converted to grayscale, percentile-normalized, polarity-corrected, adaptively thresholded, lightly morphologically closed, and rendered as black text on a white background. The alternate retry uses global Otsu thresholding. Icon and color classifiers retain color input.

Every scan carries a session ID, frame sequence, frame ID, region ID, and job ID. Stopped sessions reject pending work and ignore late results. Live capture replaces obsolete queued frames, video decoding waits for capacity, and screenshots always run to completion. Candidate delivery preserves source sequence.
- `src/ui/` owns application state projection and workflows. UI code calls domain/storage modules but does not define damage formulas.

## Persistence

`AccountDocument` is the portable public format. Schema 3 adds saved team calculation scenarios, formula target IDs, and per-action inputs. Schema 6 adds per-build optimizer profiles and a bounded history of compatible optimizer runs. Earlier backups remain importable. Every export includes `schemaVersion`, `gameDataVersion`, and `exportedAt`; imports are deeply validated before an atomic replacement transaction starts.

## Formula engine

`src/domain/calculation/` retains the original clean-room declarative engine for backward compatibility. The active Team damage path lives in `src/domain/calculation-v2/`: a GPL-compatible, source-attributed mechanics engine whose generated character, weapon, Sonata, Echo, sequence, and party effects feed member result sheets, rotation actions, and optimizer objectives through one calculation context.

Formula data is labeled `nanoka-3.5-formula-v2`. This is reproducible from the pinned dataset; it is not a claim of independent verification against the live game.

## Optimizer

The optimizer compiles each Echo into a reusable stat vector, prunes the filtered candidate frontier, and splits deterministic main-Echo and secondary-Echo tasks into bounded work units. A dynamic background-worker pool pulls those units as workers become idle, reuses compiled suffix bounds and Calculation V2 contexts, and shares the live global top-N cutoff between units. Filters cover Echo level, rarity, cost-specific main stats, manual exclusions, assignment sources, main-Echo policy, generated Sonata thresholds, partial-loadout policy, min/max calculated stats, and min/max target score. Cost-impossible, Sonata-impossible, stat-impossible, and objective-bounded subtrees are counted and skipped without leaf evaluation; the Calculation V2 evaluator receives the selected main Echo in slot one.

Exact mode explores the complete filtered search space. Fast mode reserves one coordinator-owned evaluation budget across bounded work units and is labeled `best found`, never as a global optimum. The coordinator merges and de-duplicates worker results, broadcasts stronger score cutoffs, samples the build distribution for interactive analysis, persists the five newest runs per build, fingerprints inventory state before equipping, discloses borrowed Echoes, and applies cross-build assignment changes in one IndexedDB transaction.

## Offline behavior

The PWA precaches built application assets. Previously requested Tesseract worker, WASM, and English model resources are cached with a one-year CacheFirst policy. The first OCR run therefore requires network access; later runs can use the cached resources.
